import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  IdentityVerificationError,
  computeSubjectHash,
  type NationalIdProvider,
  type ProviderRegistry,
  type VerifiedIdentity,
} from "@mapp/identity";
import type {
  AssuranceLevel,
  DeviceInfo,
  IdentityCompleteRequest,
  IdentityCompleteResponse,
  IdentityMethodsResponse,
  IdentityStartRequest,
  IdentityStartResponse,
  Me,
} from "@mapp/protocol";
import { hashPassword } from "../auth/passwords.js";
import { TokenService } from "../auth/tokens.js";
import { hashEmail } from "../contacts/hash.js";
import { isUniqueViolation } from "../db/errors.js";
import { schema, type Db, type Tx } from "../db/index.js";
import type { SignupRecord } from "../db/schema.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../errors.js";
import { toMe } from "../users/mapper.js";
import type { Vault } from "./vault.js";

const ASSURANCE_RANK: Record<AssuranceLevel, number> = { low: 0, substantial: 1, high: 2 };

export interface IdentityServiceOptions {
  publicUrl: string;
  appRedirectUrl: string;
  allowedReturnUrls: string[];
  pepper: string;
  sessionTtlSeconds: number;
  minAssurance: AssuranceLevel;
}

export interface RegistrationResult {
  user: Me;
  deviceId: string;
  deviceToken: string;
  isNewUser: boolean;
}

/**
 * Owns the whole "prove who you are, then and only then get an account" flow.
 * Sign-up = email/password + national-ID verification; both must succeed
 * before a user row exists.
 */
export class IdentityService {
  constructor(
    private readonly db: Db,
    private readonly registry: ProviderRegistry,
    private readonly vault: Vault,
    private readonly tokens: TokenService,
    private readonly opts: IdentityServiceOptions,
  ) {}

  methods(): IdentityMethodsResponse {
    return this.registry.methodsByCountry();
  }

  async start(req: IdentityStartRequest): Promise<IdentityStartResponse> {
    const provider = this.provider(req.method);
    const returnUrl = req.returnUrl ?? this.opts.appRedirectUrl;
    if (!this.opts.allowedReturnUrls.some((prefix) => returnUrl.startsWith(prefix))) {
      throw badRequest("RETURN_URL_NOT_ALLOWED", "returnUrl is not on the allow-list");
    }

    const [emailTaken] = await this.db
      .select({ userId: schema.emailCredentials.userId })
      .from(schema.emailCredentials)
      .where(eq(schema.emailCredentials.email, req.signup.email))
      .limit(1);
    if (emailTaken) throw conflict("EMAIL_TAKEN", "An account with this email already exists. Log in instead.");

    const sessionId = randomUUID();
    const state = randomBytes(24).toString("base64url");
    const callbackUrl = `${this.opts.publicUrl}/v1/identity/callback/${encodeURIComponent(provider.id)}`;
    const expiresAt = new Date(Date.now() + this.opts.sessionTtlSeconds * 1000);

    const started = await provider.start({ sessionId, state, callbackUrl });
    const signup: SignupRecord = { email: req.signup.email, passwordHash: await hashPassword(req.signup.password) };

    await this.db.insert(schema.verificationSessions).values({
      id: sessionId,
      provider: provider.id,
      state,
      callbackUrl,
      returnUrl,
      secrets: started.mode === "redirect" ? (started.secrets ?? {}) : {},
      device: req.device,
      signup,
      status: "pending",
      expiresAt,
    });

    const expires = expiresAt.toISOString();
    return started.mode === "redirect"
      ? { mode: "redirect", sessionId, url: started.url, expiresAt: expires }
      : { mode: "form", sessionId, fields: started.fields, expiresAt: expires };
  }

  /**
   * Browser lands here after a redirect-mode provider. We finish the provider
   * exchange server-side, park the result, and bounce the user back to the app
   * with a one-time ticket. Tokens are never placed in a URL.
   */
  async handleCallback(providerId: string, query: Record<string, unknown>): Promise<{ redirectTo: string }> {
    const provider = this.provider(providerId);
    const state = typeof query.state === "string" ? query.state : "";
    if (!state) throw badRequest("MISSING_STATE", "Missing state parameter");

    const [session] = await this.db
      .select()
      .from(schema.verificationSessions)
      .where(and(eq(schema.verificationSessions.state, state), eq(schema.verificationSessions.provider, provider.id)))
      .limit(1);
    if (!session) throw notFound("Verification session");
    const base = session.returnUrl ?? this.opts.appRedirectUrl;

    if (session.status !== "pending" || session.expiresAt.getTime() < Date.now()) {
      return { redirectTo: withParams(base, { sessionId: session.id, error: "SESSION_EXPIRED" }) };
    }

    try {
      const identity = await provider.complete(
        { sessionId: session.id, state: session.state, callbackUrl: session.callbackUrl, secrets: session.secrets },
        query,
      );
      const ticket = randomBytes(24).toString("base64url");
      await this.db
        .update(schema.verificationSessions)
        .set({ status: "verified", result: identity, ticketHash: TokenService.hash(ticket), secrets: {} })
        .where(eq(schema.verificationSessions.id, session.id));
      return { redirectTo: withParams(base, { sessionId: session.id, ticket }) };
    } catch (err) {
      const code = err instanceof IdentityVerificationError ? err.code : "PROVIDER_UNAVAILABLE";
      await this.db
        .update(schema.verificationSessions)
        .set({ status: "failed", error: code, secrets: {} })
        .where(eq(schema.verificationSessions.id, session.id));
      return { redirectTo: withParams(base, { sessionId: session.id, error: code }) };
    }
  }

  async complete(req: IdentityCompleteRequest): Promise<IdentityCompleteResponse> {
    const [session] = await this.db
      .select()
      .from(schema.verificationSessions)
      .where(eq(schema.verificationSessions.id, req.sessionId))
      .limit(1);
    if (!session) throw notFound("Verification session");
    if (session.expiresAt.getTime() < Date.now()) throw new AppError(410, "SESSION_EXPIRED", "Verification session expired");
    if (session.status === "completed") throw new AppError(409, "SESSION_USED", "Verification session already used");
    if (session.status === "failed") throw new AppError(409, "VERIFICATION_FAILED", session.error ?? "Verification failed");
    if (!session.signup) throw new AppError(409, "SESSION_INVALID", "Verification session has no sign-up details");
    const provider = this.provider(session.provider);

    let identity: VerifiedIdentity;
    if (session.status === "verified") {
      const ticket = typeof req.input.ticket === "string" ? req.input.ticket : "";
      if (!ticket || !session.ticketHash || TokenService.hash(ticket) !== session.ticketHash) {
        throw forbidden("Invalid verification ticket");
      }
      identity = session.result as VerifiedIdentity;
    } else {
      identity = await provider.complete(
        { sessionId: session.id, state: session.state, callbackUrl: session.callbackUrl, secrets: session.secrets },
        req.input,
      );
    }

    if (ASSURANCE_RANK[identity.assurance] < ASSURANCE_RANK[this.opts.minAssurance]) {
      throw forbidden(`Registration requires ${this.opts.minAssurance} assurance; ${provider.label} gives ${identity.assurance}`);
    }

    const registration = await this.register(identity, session.device as DeviceInfo, session.signup);

    // Scrub the parked identity and credentials so no PII lingers in the sessions table.
    await this.db
      .update(schema.verificationSessions)
      .set({ status: "completed", result: null, ticketHash: null, secrets: {}, signup: null })
      .where(eq(schema.verificationSessions.id, session.id));

    const access = await this.tokens.signAccess({ userId: registration.user.id, deviceId: registration.deviceId });
    return {
      isNewUser: registration.isNewUser,
      user: registration.user,
      tokens: {
        accessToken: access.token,
        accessExpiresAt: access.expiresAt.toISOString(),
        deviceToken: registration.deviceToken,
        deviceId: registration.deviceId,
      },
    };
  }

  /**
   * The single place where accounts come into existence. Runs in one
   * transaction so a user row can never exist without its identity row and
   * its login credential.
   */
  private async register(identity: VerifiedIdentity, device: DeviceInfo, signup: SignupRecord): Promise<RegistrationResult> {
    const subjectHash = computeSubjectHash(this.opts.pepper, identity.provider, identity.subjectId);
    const deviceToken = TokenService.newDeviceToken();

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ userId: schema.identities.userId })
        .from(schema.identities)
        .where(eq(schema.identities.subjectHash, subjectHash))
        .limit(1);

      let userId: string;
      let isNewUser = false;

      if (existing) {
        // Same national ID as an existing account. If that account already has a
        // login, this is not a sign-up: the person must log in (or reset their password).
        userId = existing.userId;
        const [cred] = await tx
          .select({ userId: schema.emailCredentials.userId })
          .from(schema.emailCredentials)
          .where(eq(schema.emailCredentials.userId, userId))
          .limit(1);
        if (cred) {
          throw conflict("ID_ALREADY_REGISTERED", "This ID is already linked to an account. Log in with your email and password instead.");
        }
      } else {
        isNewUser = true;
        const [user] = await tx
          .insert(schema.users)
          .values({ displayName: identity.fullName, verifiedCountry: identity.country })
          .returning({ id: schema.users.id });
        userId = user!.id;

        const [identityRow] = await tx
          .insert(schema.identities)
          .values({
            userId,
            provider: identity.provider,
            country: identity.country,
            assurance: identity.assurance,
            subjectHash,
            maskedId: identity.maskedId,
            fullName: identity.fullName,
            dateOfBirth: identity.dateOfBirth,
            gender: identity.gender,
            verifiedAt: new Date(identity.verifiedAt),
          })
          .returning({ id: schema.identities.id });

        const sealed = await this.vault.seal({ evidence: identity.evidence, photoBase64: identity.photoBase64 });
        await tx.insert(schema.identityEvidence).values({ identityId: identityRow!.id, sealed });
      }

      await this.attachCredential(tx, userId, signup);

      const [deviceRow] = await tx
        .insert(schema.devices)
        .values({ userId, platform: device.platform, name: device.name, tokenHash: deviceToken.hash })
        .returning({ id: schema.devices.id });

      const [userRow] = await tx.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);

      return {
        user: toMe(userRow!, signup.email),
        deviceId: deviceRow!.id,
        deviceToken: deviceToken.token,
        isNewUser,
      };
    });
  }

  private async attachCredential(tx: Tx, userId: string, signup: SignupRecord): Promise<void> {
    try {
      await tx.insert(schema.emailCredentials).values({ userId, email: signup.email, emailHash: hashEmail(signup.email), passwordHash: signup.passwordHash });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("EMAIL_TAKEN", "An account with this email already exists. Log in instead.");
      throw err;
    }
  }

  private provider(id: string): NationalIdProvider {
    const provider = this.registry.get(id);
    if (!provider) throw notFound(`Identity method "${id}"`);
    return provider;
  }
}

function withParams(base: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return base.includes("?") ? `${base}&${qs}` : `${base}?${qs}`;
}
