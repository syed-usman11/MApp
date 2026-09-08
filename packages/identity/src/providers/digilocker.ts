import { createHash, randomBytes } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import {
  IdentityVerificationError,
  normaliseDate,
  normaliseGender,
  type CompleteContext,
  type NationalIdProvider,
  type StartContext,
  type StartResult,
  type VerifiedIdentity,
} from "../types.js";

export interface DigiLockerConfig {
  clientId: string;
  clientSecret: string;
  /** Production: https://api.digitallocker.gov.in . Confirm the sandbox host in your partner docs. */
  baseUrl?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  now?: () => Date;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  digilockerid: string;
  name?: string;
  dob?: string;
  gender?: string;
  eaadhaar?: "Y" | "N" | string;
  reference_key?: string;
  new_account?: string;
}

interface AadhaarKyc {
  maskedUid: string | null;
  name: string | null;
  dob: string | null;
  gender: string | null;
  photoBase64: string | null;
}

/**
 * Aadhaar verification through DigiLocker, the Government of India's document
 * wallet. The user authenticates with their Aadhaar OTP inside DigiLocker; we
 * receive an OAuth 2.0 code and pull the signed e-KYC record.
 *
 * Requires a DigiLocker partner (requester) registration via API Setu.
 */
export class DigiLockerProvider implements NationalIdProvider {
  readonly id = "in.digilocker";
  readonly country = "IN";
  readonly label = "Aadhaar via DigiLocker";
  readonly assurance = "high" as const;

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly config: DigiLockerConfig) {
    if (!config.clientId || !config.clientSecret) {
      throw new Error("DigiLockerProvider requires clientId and clientSecret");
    }
    this.baseUrl = (config.baseUrl ?? "https://api.digitallocker.gov.in").replace(/\/+$/, "");
    this.fetchImpl = config.fetch ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  async start(ctx: StartContext): Promise<StartResult> {
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    const url = new URL(`${this.baseUrl}/public/oauth2/1/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", ctx.callbackUrl);
    url.searchParams.set("state", ctx.state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    return { mode: "redirect", url: url.toString(), secrets: { codeVerifier } };
  }

  async complete(ctx: CompleteContext, input: Record<string, unknown>): Promise<VerifiedIdentity> {
    const code = typeof input.code === "string" ? input.code : "";
    const state = typeof input.state === "string" ? input.state : "";
    if (!code) throw new IdentityVerificationError("INVALID_INPUT", "Missing authorization code");
    if (state !== ctx.state) throw new IdentityVerificationError("STATE_MISMATCH", "OAuth state does not match");
    const codeVerifier = ctx.secrets.codeVerifier;
    if (!codeVerifier) throw new IdentityVerificationError("INVALID_INPUT", "Session is missing PKCE verifier");

    const token = await this.exchangeCode(code, ctx.callbackUrl, codeVerifier);

    // DigiLocker accounts can exist with only a mobile number. We require the
    // account to be Aadhaar-verified, otherwise this is not a national ID check.
    if (token.eaadhaar !== "Y") {
      throw new IdentityVerificationError(
        "ID_NOT_LINKED",
        "This DigiLocker account is not Aadhaar-verified. Link Aadhaar in DigiLocker and try again.",
      );
    }
    if (!token.digilockerid) {
      throw new IdentityVerificationError("PROVIDER_UNAVAILABLE", "DigiLocker did not return an account id");
    }

    const kyc = await this.fetchEkyc(token.access_token);

    const fullName = kyc.name ?? token.name ?? "";
    if (!fullName) throw new IdentityVerificationError("PROVIDER_UNAVAILABLE", "DigiLocker did not return a name");

    return {
      provider: this.id,
      country: this.country,
      assurance: this.assurance,
      subjectId: token.digilockerid,
      maskedId: kyc.maskedUid ? kyc.maskedUid.slice(-4) : null,
      fullName,
      dateOfBirth: normaliseDate(kyc.dob) ?? normaliseDate(token.dob),
      gender: normaliseGender(kyc.gender) ?? normaliseGender(token.gender),
      photoBase64: kyc.photoBase64,
      evidence: { source: "digilocker-ekyc", referenceKey: token.reference_key ?? null },
      verifiedAt: this.now().toISOString(),
    };
  }

  private async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/public/oauth2/1/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (err) {
      throw new IdentityVerificationError("PROVIDER_UNAVAILABLE", "Could not reach DigiLocker", err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new IdentityVerificationError(
        res.status === 400 || res.status === 401 ? "PROVIDER_DENIED" : "PROVIDER_UNAVAILABLE",
        `DigiLocker token exchange failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    return (await res.json()) as TokenResponse;
  }

  private async fetchEkyc(accessToken: string): Promise<AadhaarKyc> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/public/oauth2/3/xml/eaadhaar`, {
        headers: { authorization: `Bearer ${accessToken}`, accept: "application/xml" },
      });
    } catch (err) {
      throw new IdentityVerificationError("PROVIDER_UNAVAILABLE", "Could not fetch e-KYC from DigiLocker", err);
    }
    if (!res.ok) {
      throw new IdentityVerificationError("PROVIDER_UNAVAILABLE", `DigiLocker e-KYC fetch failed (${res.status})`);
    }
    return parseAadhaarXml(await res.text());
  }
}

/**
 * Pulls the fields we need out of the DigiLocker e-Aadhaar XML. The document
 * nests UidData under Certificate/CertificateData/KycRes, but we walk the tree
 * so minor schema changes do not break parsing.
 */
export function parseAadhaarXml(xml: string): AadhaarKyc {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", trimValues: true });
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new IdentityVerificationError("PROVIDER_UNAVAILABLE", "e-KYC response was not valid XML", err);
  }
  const uidData = findNode(doc, "UidData") as Record<string, unknown> | undefined;
  if (!uidData) {
    throw new IdentityVerificationError("PROVIDER_UNAVAILABLE", "e-KYC response did not contain UidData");
  }
  const poi = (uidData.Poi ?? {}) as Record<string, unknown>;
  const pht = uidData.Pht;
  return {
    maskedUid: typeof uidData.uid === "string" ? uidData.uid : null,
    name: typeof poi.name === "string" ? poi.name : null,
    dob: typeof poi.dob === "string" ? poi.dob : null,
    gender: typeof poi.gender === "string" ? poi.gender : null,
    photoBase64: typeof pht === "string" && pht.length > 0 ? pht : null,
  };
}

function findNode(node: unknown, name: string): unknown {
  if (!node || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  if (name in obj) return obj[name];
  for (const value of Object.values(obj)) {
    const found = findNode(value, name);
    if (found !== undefined) return found;
  }
  return undefined;
}
