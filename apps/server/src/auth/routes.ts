import type { FastifyInstance } from "fastify";
import { ForgotPasswordRequest, LoginRequest, RefreshRequest, ResetPasswordRequest, SignupRequest, type AppConfig } from "@mapp/protocol";
import { AppError } from "../errors.js";
import { authOf, requireAuth } from "./plugin.js";
import type { AuthService } from "./service.js";
import type { TokenService } from "./tokens.js";

export function authRoutes(app: FastifyInstance, auth: AuthService, tokens: TokenService, flags: AppConfig) {
  app.get("/v1/config", async (): Promise<AppConfig> => flags);

  app.post("/v1/auth/signup", async (req) => {
    if (flags.idVerificationRequired) {
      throw new AppError(403, "ID_VERIFICATION_REQUIRED", "Accounts must be created through identity verification");
    }
    return auth.signup(SignupRequest.parse(req.body));
  });

  app.post("/v1/auth/login", async (req) => auth.login(LoginRequest.parse(req.body)));

  app.post("/v1/auth/refresh", async (req) => auth.refresh(RefreshRequest.parse(req.body)));

  app.post("/v1/auth/forgot", async (req) => auth.forgotPassword(ForgotPasswordRequest.parse(req.body).email));

  app.post("/v1/auth/reset", async (req) => auth.resetPassword(ResetPasswordRequest.parse(req.body)));

  app.post("/v1/auth/logout", { preHandler: requireAuth(tokens) }, async (req) => {
    const { userId, deviceId } = authOf(req);
    await auth.logout(userId, deviceId);
    return { ok: true as const };
  });
}
