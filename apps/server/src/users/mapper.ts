import type { Me, PublicUser } from "@mapp/protocol";
import type { schema } from "../db/index.js";

export type UserRow = typeof schema.users.$inferSelect;

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    displayName: row.displayName,
    username: row.username,
    avatarUrl: row.avatarUrl,
    verifiedCountry: row.verifiedCountry,
  };
}

/** The user's own view, including the private fields only they may see. */
export function toMe(row: UserRow, email: string | null): Me {
  return { ...toPublicUser(row), email, phone: row.phone ?? null };
}
