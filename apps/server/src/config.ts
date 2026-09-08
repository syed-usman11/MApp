import { z } from "zod";
import { AssuranceLevel } from "@mapp/protocol";

const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default("./data/pglite"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  IDENTITY_PEPPER: z.string().min(16, "IDENTITY_PEPPER must be at least 16 characters"),
  /** 64 hex chars (32 bytes). Derived from IDENTITY_PEPPER when absent, which is fine for dev only. */
  VAULT_KEY: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  VERIFICATION_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  APP_REDIRECT_URL: z.string().default("mapp://auth"),
  /** Comma-separated URL prefixes a verification may return the user to. */
  ALLOWED_RETURN_URLS: z.string().default(""),
  IDENTITY_PROVIDERS: z.string().default("mock"),
  /** Minimum assurance a verification must reach before an account is created. Set to "high" in production. */
  REGISTRATION_MIN_ASSURANCE: AssuranceLevel.default("low"),
  /** When "true", accounts can only be created through national-ID verification. "false" enables plain email/password sign-up. */
  ID_VERIFICATION_REQUIRED: z.enum(["true", "false"]).default("false"),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(10),
  LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),
  DIGILOCKER_CLIENT_ID: z.string().optional(),
  DIGILOCKER_CLIENT_SECRET: z.string().optional(),
  DIGILOCKER_BASE_URL: z.string().url().optional(),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  // Render exposes the service address as RENDER_EXTERNAL_URL; use it when PUBLIC_URL is not set explicitly.
  if (!env.PUBLIC_URL && env.RENDER_EXTERNAL_URL) env = { ...env, PUBLIC_URL: env.RENDER_EXTERNAL_URL };
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid configuration:\n  ${msg}`);
  }
  const e = parsed.data;
  const allowedReturnUrls = [e.APP_REDIRECT_URL, ...csv(e.ALLOWED_RETURN_URLS)];
  if (e.NODE_ENV !== "production") allowedReturnUrls.push("http://localhost", "exp://");

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL || undefined,
    pgliteDir: e.PGLITE_DIR,
    jwtSecret: e.JWT_SECRET,
    identityPepper: e.IDENTITY_PEPPER,
    vaultKeyHex: e.VAULT_KEY,
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
    verificationTtlSeconds: e.VERIFICATION_TTL_SECONDS,
    publicUrl: e.PUBLIC_URL.replace(/\/+$/, ""),
    appRedirectUrl: e.APP_REDIRECT_URL,
    allowedReturnUrls,
    identityProviders: csv(e.IDENTITY_PROVIDERS),
    registrationMinAssurance: e.REGISTRATION_MIN_ASSURANCE,
    idVerificationRequired: e.ID_VERIFICATION_REQUIRED === "true",
    devMode: e.NODE_ENV !== "production",
    passwordResetTtlSeconds: e.PASSWORD_RESET_TTL_SECONDS,
    loginMaxFailures: e.LOGIN_MAX_FAILURES,
    loginLockoutSeconds: e.LOGIN_LOCKOUT_SECONDS,
    digilocker: {
      clientId: e.DIGILOCKER_CLIENT_ID,
      clientSecret: e.DIGILOCKER_CLIENT_SECRET,
      baseUrl: e.DIGILOCKER_BASE_URL,
    },
  };
}
