import {
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value) {
    return Buffer.from(value);
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const assuranceLevel = pgEnum("assurance_level", ["high", "substantial", "low"]);
export const verificationStatus = pgEnum("verification_status", ["pending", "verified", "completed", "failed"]);
export const conversationType = pgEnum("conversation_type", ["direct", "group"]);

/**
 * A user row is only ever inserted inside the same transaction as its first
 * identities row. There is no other code path that creates users.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  username: text("username").unique(),
  avatarUrl: text("avatar_url"),
  /** Denormalised from identities for cheap display of the verified badge. */
  verifiedCountry: text("verified_country"),
  /** Optional E.164 number the user chose to be discoverable by. */
  phone: text("phone").unique(),
  /** SHA-256 of the normalised phone; what contact matching compares against. */
  phoneHash: text("phone_hash").unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    country: text("country").notNull(),
    assurance: assuranceLevel("assurance").notNull(),
    /** HMAC of the provider subject id. The only link back to the national ID, and it is one-way. */
    subjectHash: text("subject_hash").notNull().unique(),
    maskedId: text("masked_id"),
    fullName: text("full_name").notNull(),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    verifiedAt: ts("verified_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("identities_user_idx").on(t.userId)],
);

/**
 * Sealed provider evidence (signed XML, photo, reference keys). Encrypted with
 * the vault key before it reaches the database. In production this table moves
 * to a separate database in the required data-residency region.
 */
export const identityEvidence = pgTable("identity_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  identityId: uuid("identity_id")
    .notNull()
    .references(() => identities.id, { onDelete: "cascade" }),
  sealed: bytea("sealed").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    name: text("name").notNull(),
    pushToken: text("push_token"),
    /** Reserved for the E2EE identity key in phase 2. */
    publicKey: text("public_key"),
    /** SHA-256 of the opaque device token. */
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("devices_user_idx").on(t.userId)],
);

/**
 * Email + password login for an account. Exactly one per user. Created in the
 * same transaction as the user, once the national-ID check has passed.
 */
export const emailCredentials = pgTable(
  "email_credentials",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    /** SHA-256 of the normalised email, for contact matching. Backfilled at startup for older rows. */
    emailHash: text("email_hash"),
    passwordHash: text("password_hash").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("email_credentials_hash_idx").on(t.emailHash)],
);

export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the 6-digit code that was emailed. */
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
);

/** Credentials parked on a verification session until the ID check succeeds. */
export interface SignupRecord {
  email: string;
  passwordHash: string;
}

export const verificationSessions = pgTable("verification_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  state: text("state").notNull().unique(),
  callbackUrl: text("callback_url").notNull(),
  returnUrl: text("return_url"),
  /** Provider secrets such as a PKCE verifier. Short-lived by design. */
  secrets: jsonb("secrets").$type<Record<string, string>>().notNull(),
  device: jsonb("device").$type<{ platform: string; name: string }>().notNull(),
  signup: jsonb("signup").$type<SignupRecord>(),
  status: verificationStatus("status").notNull().default("pending"),
  /** VerifiedIdentity parked between the provider callback and the client's complete call. Cleared on completion. */
  result: jsonb("result"),
  ticketHash: text("ticket_hash"),
  error: text("error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
});

/**
 * Uploaded photos, files and voice notes. Bytes live in the row so the free
 * tier needs no object store; swap `data` for `storageKey` when moving to S3/R2.
 */
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    data: bytea("data"),
    storageKey: text("storage_key"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("media_owner_idx").on(t.ownerId)],
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: conversationType("type").notNull(),
  /** For direct chats: the two user ids sorted and joined, so a pair has exactly one conversation. */
  directKey: text("direct_key").unique(),
  /** Groups only. */
  name: text("name"),
  avatarMediaId: uuid("avatar_media_id").references(() => media.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "admin" | "member". Direct chats leave everyone a member. */
    role: text("role").notNull().default("member"),
    joinedAt: ts("joined_at").notNull().defaultNow(),
    lastReadAt: ts("last_read_at"),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("conversation_members_user_idx").on(t.userId)],
);

/** Attachment metadata stored with a message. The bytes are in `media`. */
export interface AttachmentRecord {
  mediaId: string;
  mime: string;
  name: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** text | image | file | audio | system */
    contentType: text("content_type").notNull().default("text"),
    attachment: jsonb("attachment").$type<AttachmentRecord>(),
    replyToId: uuid("reply_to_id"),
    clientId: text("client_id"),
    editedAt: ts("edited_at"),
    /** Set by "delete for everyone"; the row stays so replies and receipts keep resolving. */
    deletedAt: ts("deleted_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt)],
);

/** "Delete for me": hides a message from one member only. */
export const messageHidden = pgTable(
  "message_hidden",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

/** One reaction per user per message; re-reacting replaces the emoji. */
export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

/** Voice call log, one row per call attempt. Signalling itself is over the socket. */
export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    callerId: uuid("caller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calleeId: uuid("callee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** ringing | answered | ended | missed | declined | failed */
    status: text("status").notNull().default("ringing"),
    startedAt: ts("started_at").notNull().defaultNow(),
    answeredAt: ts("answered_at"),
    endedAt: ts("ended_at"),
  },
  (t) => [index("calls_conversation_idx").on(t.conversationId), index("calls_caller_idx").on(t.callerId), index("calls_callee_idx").on(t.calleeId)],
);

export const messageReceipts = pgTable(
  "message_receipts",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deliveredAt: ts("delivered_at"),
    readAt: ts("read_at"),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);
