import { createHash } from "node:crypto";
import { normalizeEmailForHash, normalizePhoneForHash } from "@mapp/protocol";

/** SHA-256 hex of an already-normalised identifier. Must match the client's digest byte for byte. */
export function hashIdentifier(normalised: string): string {
  return createHash("sha256").update(normalised, "utf8").digest("hex");
}

export const hashEmail = (email: string) => hashIdentifier(normalizeEmailForHash(email));
export const hashPhone = (phoneE164: string) => hashIdentifier(normalizePhoneForHash(phoneE164));
