import { randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type {
  AuthResponse,
  DeviceInfo,
  ForgotPasswordResponse,
  IdentityCompleteResponse,
  LoginRequest,
  RefreshRequest,
  RefreshResponse,
  ResetPasswordRequest,
  SignupRequest,
} from "@mapp/protocol";
import { hashEmail } from "../contacts/hash.js";
import { isUniqueViolation } from "../db/errors.js";
import { schema, type Db } from "../db/index.js";
import { AppError, badRequest, conflict, unauthenticated } from "../errors.js";
import type { Mailer } from "../mail/mailer.js";
import { toMe, type UserRow } from "../users/mapper.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { TokenService } from "./tokens.js";

export interface AuthServiceOptions {
  /** When true, password-reset responses include the code so the flow is testable without email. */
  devMode: boolean;
  resetTtlSeconds: number;
  maxLoginFailures: number;
  lockoutSeconds: number;
}

const MAX_RESET_ATTEMPTS = 5;

/**
 * Email/password sessions. Accounts are created either here (`signup`, when
 * ID verification is switched off) or by IdentityService after a national-ID
 * check. Both paths create user, credential and device in one transaction.
 */
export class AuthService {
  private readonly failures = new Map<string, { count: number; until: number }>();
  /** Verified against when the email is unknown, so timing does not reveal which emails exist. */
  private readonly dummyHash = hashPassword("not-a-real-password");

  constructor(
    private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly mailer: Mailer,
    private readonly opts: AuthServiceOptions,
  ) {}

  /** Plain email/password account, no identity row. Users created this way carry no verified badge. */
  async signup(req: SignupRequest): Promise<IdentityCompleteResponse> {
    const [taken] = await this.db
      .select({ userId: schema.emailCredentials.userId })
      .from(schema.emailCredentials)
      .where(eq(schema.emailCredentials.email, req.email))
      .limit(1);
    if (taken) throw conflict("EMAIL_TAKEN", "An account with this email already exists. Log in instead.");

    const passwordHash = await hashPassword(req.password);
    const deviceToken = TokenService.newDeviceToken();

    const created = await this.db.transaction(async (tx) => {
      const [user] = await tx.insert(schema.users).values({ displayName: req.displayName }).returning();
      try {
        await tx.insert(schema.emailCredentials).values({ userId: user!.id, email: req.email, emailHash: hashEmail(req.email), passwordHash });
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict("EMAIL_TAKEN", "An account with this email already exists. Log in instead.");
        throw err;
      }
      const [device] = await tx
        .insert(schema.devices)
        .values({ userId: user!.id, platform: req.device.platform, name: req.device.name, tokenHash: deviceToken.hash })
        .returning({ id: schema.devices.id });
      return { user: user!, deviceId: device!.id };
    });

    const access = await this.tokens.signAccess({ userId: created.user.id, deviceId: created.deviceId });
    return {
      isNewUser: true,
      user: toMe(created.user, req.email),
      tokens: {
        accessToken: access.token,
        accessExpiresAt: access.expiresAt.toISOString(),
        deviceToken: deviceToken.token,
        deviceId: created.deviceId,
      },
    };
  }

  async login(req: LoginRequest): Promise<AuthResponse> {
    this.assertNotLocked(req.email);
    const [row] = await this.db
      .select({ user: schema.users, email: schema.emailCredentials.email, passwordHash: schema.emailCredentials.passwordHash })
      .from(schema.emailCredentials)
      .innerJoin(schema.users, eq(schema.users.id, schema.emailCredentials.userId))
      .where(eq(schema.emailCredentials.email, req.email))
      .limit(1);

    const ok = row ? await verifyPassword(req.password, row.passwordHash) : await verifyPassword(req.password, await this.dummyHash);
    if (!row || !ok) {
      this.recordFailure(req.email);
      throw unauthenticated("Incorrect email or password");
    }
    this.failures.delete(req.email);
    return this.issueSession(row.user, row.email, req.device);
  }

  /** Creates a device row and returns tokens for it. Shared by login and registration. */
  async issueSession(user: UserRow, email: string | null, device: DeviceInfo): Promise<AuthResponse> {
    const deviceToken = TokenService.newDeviceToken();
    const [row] = await this.db
      .insert(schema.devices)
      .values({ userId: user.id, platform: device.platform, name: device.name, tokenHash: deviceToken.hash })
      .returning({ id: schema.devices.id });
    const access = await this.tokens.signAccess({ userId: user.id, deviceId: row!.id });
    return {
      user: toMe(user, email),
      tokens: {
        accessToken: access.token,
        accessExpiresAt: access.expiresAt.toISOString(),
        deviceToken: deviceToken.token,
        deviceId: row!.id,
      },
    };
  }

  async refresh(req: RefreshRequest): Promise<RefreshResponse> {
    const [device] = await this.db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.id, req.deviceId), isNull(schema.devices.revokedAt)))
      .limit(1);
    if (!device || device.tokenHash !== TokenService.hash(req.deviceToken)) {
      throw unauthenticated("Invalid device credentials");
    }
    await this.db.update(schema.devices).set({ lastSeenAt: new Date() }).where(eq(schema.devices.id, device.id));
    const access = await this.tokens.signAccess({ userId: device.userId, deviceId: device.id });
    return { accessToken: access.token, accessExpiresAt: access.expiresAt.toISOString() };
  }

  async logout(userId: string, deviceId: string): Promise<void> {
    await this.db
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId)));
  }

  /** Always answers OK so the response does not reveal whether the email is registered. */
  async forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    if (!this.mailer.delivers && !this.opts.devMode) {
      throw new AppError(503, "MAIL_NOT_CONFIGURED", "Password reset email is not set up on this server yet. Ask the administrator to configure SMTP or Resend.");
    }
    const [cred] = await this.db.select().from(schema.emailCredentials).where(eq(schema.emailCredentials.email, email)).limit(1);
    if (!cred) return { ok: true };

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const now = new Date();
    await this.db
      .update(schema.passwordResets)
      .set({ usedAt: now })
      .where(and(eq(schema.passwordResets.userId, cred.userId), isNull(schema.passwordResets.usedAt)));
    await this.db.insert(schema.passwordResets).values({
      userId: cred.userId,
      codeHash: TokenService.hash(code),
      expiresAt: new Date(now.getTime() + this.opts.resetTtlSeconds * 1000),
    });
    await this.mailer.send({
      to: email,
      subject: "Your MApp password reset code",
      text: `Your password reset code is ${code}. It expires in ${Math.round(this.opts.resetTtlSeconds / 60)} minutes. If you did not request this, you can ignore this email.`,
    });
    return this.opts.devMode ? { ok: true, devCode: code } : { ok: true };
  }

  async resetPassword(req: ResetPasswordRequest): Promise<{ ok: true }> {
    const invalid = () => badRequest("INVALID_CODE", "That code is invalid or has expired");
    const [cred] = await this.db.select().from(schema.emailCredentials).where(eq(schema.emailCredentials.email, req.email)).limit(1);
    if (!cred) throw invalid();

    const [reset] = await this.db
      .select()
      .from(schema.passwordResets)
      .where(and(eq(schema.passwordResets.userId, cred.userId), isNull(schema.passwordResets.usedAt), gt(schema.passwordResets.expiresAt, new Date())))
      .orderBy(desc(schema.passwordResets.createdAt))
      .limit(1);
    if (!reset || reset.attempts >= MAX_RESET_ATTEMPTS) throw invalid();

    const expected = Buffer.from(reset.codeHash, "hex");
    const actual = Buffer.from(TokenService.hash(req.code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.db
        .update(schema.passwordResets)
        .set({ attempts: sql`${schema.passwordResets.attempts} + 1` })
        .where(eq(schema.passwordResets.id, reset.id));
      throw invalid();
    }

    const passwordHash = await hashPassword(req.newPassword);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(schema.emailCredentials).set({ passwordHash, updatedAt: now }).where(eq(schema.emailCredentials.userId, cred.userId));
      await tx.update(schema.passwordResets).set({ usedAt: now }).where(eq(schema.passwordResets.id, reset.id));
      // Every existing session is signed out; the person must log in again with the new password.
      await tx
        .update(schema.devices)
        .set({ revokedAt: now })
        .where(and(eq(schema.devices.userId, cred.userId), isNull(schema.devices.revokedAt)));
    });
    return { ok: true };
  }

  private assertNotLocked(key: string): void {
    const f = this.failures.get(key);
    if (f && f.count >= this.opts.maxLoginFailures && f.until > Date.now()) {
      throw new AppError(429, "TOO_MANY_ATTEMPTS", "Too many failed attempts. Try again later.");
    }
  }

  private recordFailure(key: string): void {
    const now = Date.now();
    const f = this.failures.get(key);
    if (!f || f.until < now) this.failures.set(key, { count: 1, until: now + this.opts.lockoutSeconds * 1000 });
    else f.count += 1;
  }
}
