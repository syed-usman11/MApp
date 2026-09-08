import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { IdentityVerificationError, type ProviderRegistry } from "@mapp/identity";
import { authRoutes } from "./auth/routes.js";
import { AuthService } from "./auth/service.js";
import { TokenService } from "./auth/tokens.js";
import { ConsoleMailer, type Mailer } from "./mail/mailer.js";
import { ChatService } from "./chat/service.js";
import { chatRoutes } from "./chat/routes.js";
import { contactRoutes } from "./contacts/routes.js";
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import { AppError } from "./errors.js";
import { identityRoutes } from "./identity/routes.js";
import { IdentityService } from "./identity/service.js";
import type { Vault } from "./identity/vault.js";
import { userRoutes } from "./users/routes.js";
import { registerGateway } from "./ws/gateway.js";
import { Hub } from "./ws/hub.js";

export interface AppDeps {
  config: Config;
  db: Db;
  registry: ProviderRegistry;
  vault: Vault;
  mailer?: Mailer;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db, registry, vault } = deps;
  const app = Fastify({ logger: deps.logger ?? config.nodeEnv !== "test" });

  await app.register(cors, { origin: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const tokens = new TokenService(config.jwtSecret, config.accessTokenTtlSeconds);
  const identity = new IdentityService(db, registry, vault, tokens, {
    publicUrl: config.publicUrl,
    appRedirectUrl: config.appRedirectUrl,
    allowedReturnUrls: config.allowedReturnUrls,
    pepper: config.identityPepper,
    sessionTtlSeconds: config.verificationTtlSeconds,
    minAssurance: config.registrationMinAssurance,
  });
  const mailer = deps.mailer ?? new ConsoleMailer((obj, msg) => app.log.info(obj, msg));
  const auth = new AuthService(db, tokens, mailer, {
    devMode: config.devMode,
    resetTtlSeconds: config.passwordResetTtlSeconds,
    maxLoginFailures: config.loginMaxFailures,
    lockoutSeconds: config.loginLockoutSeconds,
  });
  const chat = new ChatService(db);
  const hub = new Hub();

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      return reply.status(400).send({ error: { code: "VALIDATION", message } });
    }
    if (err instanceof IdentityVerificationError) {
      const status = err.code === "PROVIDER_UNAVAILABLE" ? 502 : err.code === "PROVIDER_DENIED" ? 403 : 400;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { statusCode?: unknown; message?: unknown };
    const status = typeof e.statusCode === "number" ? e.statusCode : 500;
    if (status >= 500) req.log.error({ err }, "unhandled error");
    const message = status >= 500 ? "Internal error" : typeof e.message === "string" ? e.message : "Bad request";
    return reply.status(status).send({ error: { code: status >= 500 ? "INTERNAL" : "BAD_REQUEST", message } });
  });

  app.get("/health", async () => ({ ok: true }));

  identityRoutes(app, identity);
  authRoutes(app, auth, tokens, { idVerificationRequired: config.idVerificationRequired });
  userRoutes(app, db, tokens);
  contactRoutes(app, db, tokens);
  chatRoutes(app, chat, tokens);
  registerGateway(app, { hub, chat, tokens });

  return app;
}
