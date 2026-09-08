import type { FastifyInstance } from "fastify";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { ContactsMatchRequest, type ContactsMatchResponse } from "@mapp/protocol";
import { authOf, requireAuth } from "../auth/plugin.js";
import type { TokenService } from "../auth/tokens.js";
import { schema, type Db } from "../db/index.js";
import { toPublicUser } from "../users/mapper.js";
import { hashEmail } from "./hash.js";

export function contactRoutes(app: FastifyInstance, db: Db, tokens: TokenService) {
  /**
   * Which of these hashed identifiers belong to registered users? The caller
   * never learns anything about hashes that do not match, and never sees
   * another user's email or phone, only their public profile.
   */
  app.post("/v1/contacts/match", { preHandler: requireAuth(tokens) }, async (req): Promise<ContactsMatchResponse> => {
    const { userId } = authOf(req);
    const { hashes } = ContactsMatchRequest.parse(req.body);
    const unique = [...new Set(hashes)];

    const byPhone = await db
      .select({ hash: schema.users.phoneHash, user: schema.users })
      .from(schema.users)
      .where(and(inArray(schema.users.phoneHash, unique), ne(schema.users.id, userId)));

    const byEmail = await db
      .select({ hash: schema.emailCredentials.emailHash, user: schema.users })
      .from(schema.emailCredentials)
      .innerJoin(schema.users, eq(schema.users.id, schema.emailCredentials.userId))
      .where(and(inArray(schema.emailCredentials.emailHash, unique), ne(schema.users.id, userId)));

    const seen = new Set<string>();
    const matches: ContactsMatchResponse["matches"] = [];
    for (const row of [...byPhone, ...byEmail]) {
      if (!row.hash || seen.has(row.hash)) continue;
      seen.add(row.hash);
      matches.push({ hash: row.hash, user: toPublicUser(row.user) });
    }
    return { matches };
  });
}

/** Older credential rows predate email hashing; compute them once at startup. */
export async function backfillEmailHashes(db: Db): Promise<number> {
  const rows = await db
    .select({ userId: schema.emailCredentials.userId, email: schema.emailCredentials.email })
    .from(schema.emailCredentials)
    .where(isNull(schema.emailCredentials.emailHash));
  for (const row of rows) {
    await db.update(schema.emailCredentials).set({ emailHash: hashEmail(row.email) }).where(eq(schema.emailCredentials.userId, row.userId));
  }
  return rows.length;
}
