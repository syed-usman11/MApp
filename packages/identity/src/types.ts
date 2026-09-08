import type { AssuranceLevel, FormField } from "@mapp/protocol";

/**
 * The normalised result of a successful national-ID verification.
 * Every provider, in every country, must produce exactly this shape.
 */
export interface VerifiedIdentity {
  /** Provider id, e.g. "in.digilocker". */
  provider: string;
  /** ISO 3166-1 alpha-2 country of the ID scheme. */
  country: string;
  assurance: AssuranceLevel;
  /**
   * Stable identifier scoped to the provider, used only to detect the same
   * person registering twice. Must NEVER be a raw national ID number; use the
   * scheme's opaque subject id or a one-way hash of the number.
   */
  subjectId: string;
  /** Display-safe fragment such as the last 4 digits, or null. */
  maskedId: string | null;
  fullName: string;
  /** ISO date YYYY-MM-DD, or null when the scheme does not return it. */
  dateOfBirth: string | null;
  gender: "M" | "F" | "X" | null;
  /** Base64 JPEG when the scheme returns a photo. */
  photoBase64: string | null;
  /** Raw signed evidence to be sealed in the identity vault. Provider-defined. */
  evidence: unknown;
  verifiedAt: string;
}

export interface StartContext {
  sessionId: string;
  /** Random per-session value the provider must echo back (OAuth state). */
  state: string;
  /** Server-side URL the provider should redirect to after the user finishes. */
  callbackUrl: string;
}

export type StartResult =
  | {
      mode: "redirect";
      url: string;
      /** Values the server must keep for `complete`, e.g. a PKCE verifier. Never sent to the client. */
      secrets?: Record<string, string>;
    }
  | {
      mode: "form";
      fields: FormField[];
    };

export interface CompleteContext extends StartContext {
  secrets: Record<string, string>;
}

export interface NationalIdProvider {
  readonly id: string;
  readonly country: string;
  readonly label: string;
  readonly assurance: AssuranceLevel;
  start(ctx: StartContext): Promise<StartResult>;
  complete(ctx: CompleteContext, input: Record<string, unknown>): Promise<VerifiedIdentity>;
}

export type IdentityErrorCode =
  | "INVALID_INPUT"
  | "PROVIDER_DENIED"
  | "PROVIDER_UNAVAILABLE"
  | "STATE_MISMATCH"
  | "ID_NOT_LINKED"
  | "SIGNATURE_INVALID";

export class IdentityVerificationError extends Error {
  constructor(
    public readonly code: IdentityErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IdentityVerificationError";
  }
}

/** Normalise the many date formats national schemes use into YYYY-MM-DD. */
export function normaliseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/))) return `${m[3]}-${m[2]}-${m[1]}`;
  if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export function normaliseGender(raw: string | null | undefined): "M" | "F" | "X" | null {
  if (!raw) return null;
  const g = raw.trim().toUpperCase();
  if (g.startsWith("M")) return "M";
  if (g.startsWith("F")) return "F";
  if (g === "T" || g === "O" || g === "X") return "X";
  return null;
}
