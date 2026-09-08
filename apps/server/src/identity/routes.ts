import type { FastifyInstance } from "fastify";
import { IdentityCompleteRequest, IdentityStartRequest } from "@mapp/protocol";
import type { IdentityService } from "./service.js";

export function identityRoutes(app: FastifyInstance, identity: IdentityService) {
  app.get("/v1/identity/methods", async () => identity.methods());

  app.post("/v1/identity/start", async (req) => identity.start(IdentityStartRequest.parse(req.body)));

  app.get<{ Params: { provider: string }; Querystring: Record<string, unknown> }>(
    "/v1/identity/callback/:provider",
    async (req, reply) => {
      const { redirectTo } = await identity.handleCallback(req.params.provider, req.query);
      return reply.redirect(redirectTo, 302);
    },
  );

  app.post("/v1/identity/complete", async (req) => identity.complete(IdentityCompleteRequest.parse(req.body)));
}
