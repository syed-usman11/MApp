import { z } from "zod";
import { DeviceInfo, Id, Me, PhoneE164, PublicUser } from "./common.js";

/**
 * How strongly the identity was proven.
 *  - high:        government eID or cryptographically signed chip read
 *  - substantial: document photo + face match via a certified vendor
 *  - low:         self-asserted (mock / dev only)
 */
export const AssuranceLevel = z.enum(["high", "substantial", "low"]);
export type AssuranceLevel = z.infer<typeof AssuranceLevel>;

export const CountryCode = z.string().regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2");

/** Describes a provider the client may offer to the user. */
export const IdentityMethod = z.object({
  id: z.string(),
  country: CountryCode,
  label: z.string(),
  assurance: AssuranceLevel,
});
export type IdentityMethod = z.infer<typeof IdentityMethod>;

export const IdentityMethodsResponse = z.object({
  countries: z.array(
    z.object({
      code: CountryCode,
      name: z.string(),
      methods: z.array(IdentityMethod),
    }),
  ),
});
export type IdentityMethodsResponse = z.infer<typeof IdentityMethodsResponse>;

// ---- Email + password credentials ------------------------------------------

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address");

export const Password = z.string().min(8, "Use at least 8 characters").max(128);

export const SignupCredentials = z.object({
  email: Email,
  password: Password,
});
export type SignupCredentials = z.infer<typeof SignupCredentials>;

// ---- Sign-up: credentials + national ID verification -----------------------

export const IdentityStartRequest = z.object({
  method: z.string(),
  device: DeviceInfo,
  /** The email/password the account will log in with once the ID check succeeds. */
  signup: SignupCredentials,
  /** Where the provider should send the user back (native deep link or web URL). */
  returnUrl: z.string().url().optional(),
});
export type IdentityStartRequest = z.infer<typeof IdentityStartRequest>;

export const FormField = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(["text", "date", "number"]),
  required: z.boolean().default(true),
});
export type FormField = z.infer<typeof FormField>;

export const IdentityStartResponse = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("redirect"),
    sessionId: Id,
    url: z.string().url(),
    expiresAt: z.string(),
  }),
  z.object({
    mode: z.literal("form"),
    sessionId: Id,
    fields: z.array(FormField),
    expiresAt: z.string(),
  }),
]);
export type IdentityStartResponse = z.infer<typeof IdentityStartResponse>;

export const IdentityCompleteRequest = z.object({
  sessionId: Id,
  /** Provider-specific input: form values for form-mode, or { ticket } after a redirect callback. */
  input: z.record(z.string(), z.unknown()).default({}),
});
export type IdentityCompleteRequest = z.infer<typeof IdentityCompleteRequest>;

export const AuthTokens = z.object({
  accessToken: z.string(),
  accessExpiresAt: z.string(),
  deviceToken: z.string(),
  deviceId: Id,
});
export type AuthTokens = z.infer<typeof AuthTokens>;

export const AuthResponse = z.object({
  user: Me,
  tokens: AuthTokens,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const IdentityCompleteResponse = AuthResponse.extend({
  isNewUser: z.boolean(),
});
export type IdentityCompleteResponse = z.infer<typeof IdentityCompleteResponse>;

// ---- Direct sign-up (only when ID verification is switched off) --------------

export const SignupRequest = z.object({
  displayName: z.string().trim().min(1, "Enter your name").max(60),
  email: Email,
  password: Password,
  device: DeviceInfo,
});
export type SignupRequest = z.infer<typeof SignupRequest>;

/** Feature flags the client needs before it can render the sign-up flow. */
export const AppConfig = z.object({
  /** When true, sign-up must go through /v1/identity/*; /v1/auth/signup is disabled. */
  idVerificationRequired: z.boolean(),
});
export type AppConfig = z.infer<typeof AppConfig>;

// ---- Login / session ---------------------------------------------------------

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1, "Enter your password"),
  device: DeviceInfo,
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const RefreshRequest = z.object({
  deviceId: Id,
  deviceToken: z.string(),
});
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const RefreshResponse = z.object({
  accessToken: z.string(),
  accessExpiresAt: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const LogoutResponse = z.object({ ok: z.literal(true) });

// ---- Forgot / reset password -------------------------------------------------

export const ForgotPasswordRequest = z.object({ email: Email });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const ForgotPasswordResponse = z.object({
  ok: z.literal(true),
  /** Only present when the server runs in development mode, so the flow can be tested without an email provider. */
  devCode: z.string().optional(),
});
export type ForgotPasswordResponse = z.infer<typeof ForgotPasswordResponse>;

export const ResetPasswordRequest = z.object({
  email: Email,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
  newPassword: Password,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

// ---- Profile -----------------------------------------------------------------

export const UpdateProfileRequest = z.object({
  displayName: z.string().min(1).max(60).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits and underscore only")
    .optional(),
  /** E.164 number. Required on every account, so it can be changed but never removed. */
  phone: PhoneE164.optional(),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;

// ---- Contact discovery -------------------------------------------------------

/**
 * Identifiers are never sent raw. Client and server both hash the normalised
 * value with SHA-256 and compare hex digests. Normalisation lives here so both
 * sides agree: emails lower-cased and trimmed, phones as E.164.
 */
export function normalizeEmailForHash(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhoneForHash(phoneE164: string): string {
  return phoneE164.trim();
}

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 hex digest");

export const ContactsMatchRequest = z.object({
  hashes: z.array(Sha256Hex).min(1).max(500),
});
export type ContactsMatchRequest = z.infer<typeof ContactsMatchRequest>;

export const ContactsMatchResponse = z.object({
  matches: z.array(z.object({ hash: Sha256Hex, user: PublicUser })),
});
export type ContactsMatchResponse = z.infer<typeof ContactsMatchResponse>;
