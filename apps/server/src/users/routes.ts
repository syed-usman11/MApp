import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { LookupUserQuery, UpdateProfileRequest, type Me } from "@mapp/protocol";
import { toMe } from "./mapper.js";
import { authOf, requireAuth } from "../auth/plugin.js";
import type { TokenService } from "../auth/tokens.js";
import { hashPhone } from "../contacts/hash.js";
import { isUniqueViolation } from "../db/errors.js";
import { schema, type Db } from "../db/index.js";
import { conflict, notFound } from "../errors.js";
import { toPublicUser } from "./mapper.js";

export function userRoutes(app: FastifyInstance, db: Db, tokens: TokenService) {
  const auth = { preHandler: requireAuth(tokens) };

  async function loadMe(userId: string): Promise<Me> {
    const [row] = await db
      .select({ user: schema.users, email: schema.emailCredentials.email })
      .from(schema.users)
      .leftJoin(schema.emailCredentials, eq(schema.emailCredentials.userId, schema.users.id))
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!row) throw notFound("User");
    return toMe(row.user, row.email ?? null);
  }

  app.get("/v1/me", auth, async (req) => loadMe(authOf(req).userId));

  app.patch("/v1/me", auth, async (req) => {
    const { userId } = authOf(req);
    const body = UpdateProfileRequest.parse(req.body);
    if (body.username) {
      const [taken] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.username, body.username))
        .limit(1);
      if (taken && taken.id !== userId) throw conflict("USERNAME_TAKEN", "That username is taken");
    }
    const patch: Partial<typeof schema.users.$inferInsert> = {};
    if (body.displayName) patch.displayName = body.displayName;
    if (body.username) patch.username = body.username;
    if (body.phone !== undefined) {
      patch.phone = body.phone;
      patch.phoneHash = hashPhone(body.phone);
    }
    if (Object.keys(patch).length > 0) {
      try {
        await db.update(schema.users).set(patch).where(eq(schema.users.id, userId));
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict("PHONE_TAKEN", "That phone number is already linked to another account");
        throw err;
      }
    }
    return loadMe(userId);
  });

  app.get("/v1/users/lookup", auth, async (req) => {
    const q = LookupUserQuery.parse(req.query);
    const [row] = await db.select().from(schema.users).where(eq(schema.users.username, q.username.toLowerCase())).limit(1);
    if (!row) throw notFound("User");
    return toPublicUser(row);
  });
}
