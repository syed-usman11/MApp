import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthenticated } from "../errors.js";
import type { AuthContext, TokenService } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function requireAuth(tokens: TokenService) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) throw unauthenticated("Missing bearer token");
    req.auth = await tokens.verifyAccess(header.slice("Bearer ".length));
  };
}

export function authOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
