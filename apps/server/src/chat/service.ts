import { and, desc, eq, gt, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type {
  AttachmentInput,
  ContentType,
  Conversation,
  DeleteScope,
  ListMessagesQuery,
  MemberRole,
  Message,
  Reaction,
  ReceiptKind,
  ReceiptSummary,
  ReplyPreview,
  SearchResponse,
} from "@mapp/protocol";
import { schema, type Db, type DbOrTx } from "../db/index.js";
import { badRequest, forbidden, notFound } from "../errors.js";
import type { MediaService } from "../media/service.js";
import { toPublicUser } from "../users/mapper.js";

type MessageRow = typeof schema.messages.$inferSelect;

const EDIT_WINDOW_MS = 15 * 60 * 1000;

export interface SendInput {
  conversationId: string;
  clientId: string;
  body: string;
  contentType: Exclude<ContentType, "system">;
  attachment?: AttachmentInput;
  replyToId?: string;
}

/** A short, human line for chat lists and push notifications. */
export function previewOf(message: Pick<Message, "body" | "contentType" | "deleted">): string {
  if (message.deleted) return "This message was deleted";
  switch (message.contentType) {
    case "image":
      return message.body ? `📷 ${message.body}` : "📷 Photo";
    case "video":
      return message.body ? `🎥 ${message.body}` : "🎥 Video";
    case "audio":
      return "🎤 Voice message";
    case "file":
      return message.body ? `📎 ${message.body}` : "📎 File";
    default:
      return message.body;
  }
}

export class ChatService {
  constructor(
    private readonly db: Db,
    private readonly media: MediaService,
  ) {}

  // ---------- conversations ----------

  async getOrCreateDirect(userId: string, otherUsername: string): Promise<Conversation> {
    const [other] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, otherUsername.toLowerCase()))
      .limit(1);
    if (!other) throw notFound("User");
    if (other.id === userId) throw badRequest("SELF_CHAT", "You cannot start a chat with yourself");

    const directKey = [userId, other.id].sort().join(":");
    const [existing] = await this.db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.directKey, directKey))
      .limit(1);

    const conversationId =
      existing?.id ??
      (await this.db.transaction(async (tx) => {
        const [conv] = await tx
          .insert(schema.conversations)
          .values({ type: "direct", directKey, createdBy: userId })
          .returning({ id: schema.conversations.id });
        await tx.insert(schema.conversationMembers).values([
          { conversationId: conv!.id, userId },
          { conversationId: conv!.id, userId: other.id },
        ]);
        return conv!.id;
      }));

    return (await this.loadConversation(userId, conversationId))!;
  }

  async createGroup(userId: string, name: string, memberIds: string[]): Promise<Conversation> {
    const others = [...new Set(memberIds.filter((id) => id !== userId))];
    if (others.length === 0) throw badRequest("NO_MEMBERS", "Add at least one other person");
    const found = await this.db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, others));
    if (found.length !== others.length) throw notFound("User");

    const conversationId = await this.db.transaction(async (tx) => {
      const [conv] = await tx
        .insert(schema.conversations)
        .values({ type: "group", name, createdBy: userId })
        .returning({ id: schema.conversations.id });
      await tx.insert(schema.conversationMembers).values([
        { conversationId: conv!.id, userId, role: "admin" },
        ...others.map((id) => ({ conversationId: conv!.id, userId: id, role: "member" })),
      ]);
      await this.systemMessage(tx, conv!.id, userId, `created the group "${name}"`);
      return conv!.id;
    });
    return (await this.loadConversation(userId, conversationId))!;
  }

  async updateGroup(userId: string, conversationId: string, patch: { name?: string; avatarMediaId?: string | null }): Promise<Conversation> {
    await this.assertAdmin(userId, conversationId);
    if (patch.avatarMediaId) await this.media.assertOwned(userId, { mediaId: patch.avatarMediaId, mime: "", name: "", size: 0 });
    const set: Partial<typeof schema.conversations.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.avatarMediaId !== undefined) set.avatarMediaId = patch.avatarMediaId;
    if (Object.keys(set).length > 0) {
      await this.db.update(schema.conversations).set(set).where(eq(schema.conversations.id, conversationId));
      if (patch.name !== undefined) await this.systemMessage(this.db, conversationId, userId, `renamed the group to "${patch.name}"`);
    }
    return (await this.loadConversation(userId, conversationId))!;
  }

  async addMembers(userId: string, conversationId: string, memberIds: string[]): Promise<{ conversation: Conversation; added: string[] }> {
    await this.assertAdmin(userId, conversationId);
    const current = new Set(await this.memberIds(conversationId));
    const wanted = [...new Set(memberIds)].filter((id) => !current.has(id));
    if (wanted.length === 0) return { conversation: (await this.loadConversation(userId, conversationId))!, added: [] };
    const found = await this.db.select().from(schema.users).where(inArray(schema.users.id, wanted));
    if (found.length !== wanted.length) throw notFound("User");
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.conversationMembers).values(wanted.map((id) => ({ conversationId, userId: id, role: "member" })));
      await this.systemMessage(tx, conversationId, userId, `added ${found.map((u) => u.displayName).join(", ")}`);
    });
    return { conversation: (await this.loadConversation(userId, conversationId))!, added: wanted };
  }

  /** Admins can remove anyone; anyone can remove themselves (leave). */
  async removeMember(userId: string, conversationId: string, targetId: string): Promise<{ conversation: Conversation | null; members: string[] }> {
    const [conv] = await this.db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).limit(1);
    if (!conv || conv.type !== "group") throw notFound("Group");
    const role = await this.roleOf(userId, conversationId);
    if (!role) throw forbidden("Not a member of this conversation");
    if (targetId !== userId && role !== "admin") throw forbidden("Only admins can remove members");
    const [target] = await this.db.select().from(schema.users).where(eq(schema.users.id, targetId)).limit(1);
    if (!target) throw notFound("User");

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.conversationMembers)
        .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, targetId)));
      // Keep the group administrable: promote the longest-standing member if no admin is left.
      const [admin] = await tx
        .select({ userId: schema.conversationMembers.userId })
        .from(schema.conversationMembers)
        .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.role, "admin")))
        .limit(1);
      if (!admin) {
        const [oldest] = await tx
          .select({ userId: schema.conversationMembers.userId })
          .from(schema.conversationMembers)
          .where(eq(schema.conversationMembers.conversationId, conversationId))
          .orderBy(schema.conversationMembers.joinedAt)
          .limit(1);
        if (oldest) {
          await tx
            .update(schema.conversationMembers)
            .set({ role: "admin" })
            .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, oldest.userId)));
        }
      }
      await this.systemMessage(tx, conversationId, userId, targetId === userId ? "left" : `removed ${target.displayName}`);
    });
    const members = await this.memberIds(conversationId);
    const viewer = members[0];
    return { conversation: viewer ? await this.loadConversation(viewer, conversationId) : null, members };
  }

  async listConversations(userId: string): Promise<Conversation[]> {
    const memberships = await this.db
      .select({ conversationId: schema.conversationMembers.conversationId })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.userId, userId));
    const out: Conversation[] = [];
    for (const m of memberships) {
      const c = await this.loadConversation(userId, m.conversationId);
      if (c) out.push(c);
    }
    out.sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
    return out;
  }

  async conversationFor(userId: string, conversationId: string): Promise<Conversation> {
    const c = await this.loadConversation(userId, conversationId);
    if (!c) throw notFound("Conversation");
    return c;
  }

  async memberIds(conversationId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.conversationId, conversationId));
    return rows.map((r) => r.userId);
  }

  /** Every user this user shares a conversation with. Used for presence fan-out. */
  async peerIds(userId: string): Promise<string[]> {
    const mine = await this.db
      .select({ conversationId: schema.conversationMembers.conversationId })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.userId, userId));
    if (mine.length === 0) return [];
    const rows = await this.db
      .select({ userId: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(
        and(
          inArray(
            schema.conversationMembers.conversationId,
            mine.map((m) => m.conversationId),
          ),
          ne(schema.conversationMembers.userId, userId),
        ),
      );
    return [...new Set(rows.map((r) => r.userId))];
  }

  /** Sum of unread counts across all conversations, for the app icon badge. */
  async unreadTotal(userId: string): Promise<number> {
    const rows = await this.db
      .select({ conversationId: schema.conversationMembers.conversationId, lastReadAt: schema.conversationMembers.lastReadAt })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.userId, userId));
    let total = 0;
    for (const r of rows) {
      const conditions = [eq(schema.messages.conversationId, r.conversationId), ne(schema.messages.senderId, userId), ne(schema.messages.contentType, "system")];
      if (r.lastReadAt) conditions.push(gt(schema.messages.createdAt, r.lastReadAt));
      const [c] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(and(...conditions));
      total += c?.count ?? 0;
    }
    return total;
  }

  // ---------- messages ----------

  async listMessages(userId: string, conversationId: string, q: ListMessagesQuery): Promise<{ messages: Message[]; hasMore: boolean }> {
    await this.assertMember(userId, conversationId);
    const conditions = [eq(schema.messages.conversationId, conversationId), this.notHiddenFor(userId)];
    if (q.before) conditions.push(lt(schema.messages.createdAt, new Date(q.before)));
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(desc(schema.messages.createdAt))
      .limit(q.limit + 1);
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit).reverse();
    const receipts = await this.receiptSummaries(userId, conversationId, page);
    const messages = await this.hydrate(page);
    return {
      messages: messages.map((m) => {
        const receipt = receipts.get(m.id);
        return receipt ? { ...m, receipt } : m;
      }),
      hasMore,
    };
  }

  async getMessage(messageId: string): Promise<Message> {
    const row = await this.row(messageId);
    return (await this.hydrate([row]))[0]!;
  }

  async sendMessage(userId: string, input: SendInput): Promise<Message> {
    await this.assertMember(userId, input.conversationId);
    const body = input.body.trim();
    let attachment = null;
    if (input.attachment) {
      attachment = await this.media.assertOwned(userId, input.attachment);
    } else if (input.contentType !== "text") {
      throw badRequest("ATTACHMENT_REQUIRED", "That message type needs an attachment");
    }
    if (!attachment && body.length === 0) throw badRequest("EMPTY_MESSAGE", "Type a message first");
    if (input.replyToId) {
      const target = await this.row(input.replyToId);
      if (target.conversationId !== input.conversationId) throw badRequest("BAD_REPLY", "You can only reply within the same chat");
    }
    const [row] = await this.db
      .insert(schema.messages)
      .values({
        conversationId: input.conversationId,
        senderId: userId,
        body,
        contentType: attachment ? input.contentType : "text",
        attachment,
        replyToId: input.replyToId ?? null,
        clientId: input.clientId,
      })
      .returning();
    return (await this.hydrate([row!]))[0]!;
  }

  async editMessage(userId: string, messageId: string, body: string): Promise<Message> {
    const row = await this.row(messageId);
    if (row.senderId !== userId) throw forbidden("You can only edit your own messages");
    if (row.deletedAt) throw badRequest("DELETED", "That message was deleted");
    if (row.contentType === "system") throw badRequest("NOT_EDITABLE", "That message cannot be edited");
    if (Date.now() - row.createdAt.getTime() > EDIT_WINDOW_MS) throw badRequest("EDIT_WINDOW", "Messages can be edited for 15 minutes after sending");
    const [updated] = await this.db
      .update(schema.messages)
      .set({ body: body.trim(), editedAt: new Date() })
      .where(eq(schema.messages.id, messageId))
      .returning();
    return (await this.hydrate([updated!]))[0]!;
  }

  /**
   * "me" hides the message for the caller only. "everyone" tombstones it for
   * all members; allowed for the sender, or a group admin moderating.
   */
  async deleteMessage(userId: string, messageId: string, scope: DeleteScope): Promise<{ message: Message; broadcast: boolean }> {
    const row = await this.row(messageId);
    await this.assertMember(userId, row.conversationId);
    if (scope === "me") {
      await this.db.insert(schema.messageHidden).values({ messageId, userId }).onConflictDoNothing();
      return { message: (await this.hydrate([row]))[0]!, broadcast: false };
    }
    if (row.senderId !== userId && (await this.roleOf(userId, row.conversationId)) !== "admin") {
      throw forbidden("Only the sender or a group admin can delete for everyone");
    }
    if (row.deletedAt) return { message: (await this.hydrate([row]))[0]!, broadcast: false };
    const [updated] = await this.db
      .update(schema.messages)
      .set({ deletedAt: new Date(), body: "", attachment: null, editedAt: null })
      .where(eq(schema.messages.id, messageId))
      .returning();
    await this.db.delete(schema.messageReactions).where(eq(schema.messageReactions.messageId, messageId));
    return { message: (await this.hydrate([updated!]))[0]!, broadcast: true };
  }

  async react(userId: string, messageId: string, emoji: string | null): Promise<{ conversationId: string }> {
    const row = await this.row(messageId);
    await this.assertMember(userId, row.conversationId);
    if (row.deletedAt) throw badRequest("DELETED", "That message was deleted");
    if (emoji === null) {
      await this.db
        .delete(schema.messageReactions)
        .where(and(eq(schema.messageReactions.messageId, messageId), eq(schema.messageReactions.userId, userId)));
    } else {
      await this.db
        .insert(schema.messageReactions)
        .values({ messageId, userId, emoji })
        .onConflictDoUpdate({ target: [schema.messageReactions.messageId, schema.messageReactions.userId], set: { emoji, createdAt: new Date() } });
    }
    return { conversationId: row.conversationId };
  }

  async search(userId: string, q: string, limit: number): Promise<SearchResponse> {
    const memberships = await this.db
      .select({ conversationId: schema.conversationMembers.conversationId })
      .from(schema.conversationMembers)
      .where(eq(schema.conversationMembers.userId, userId));
    const ids = memberships.map((m) => m.conversationId);
    if (ids.length === 0) return { messages: [], conversations: [] };

    const pattern = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    const rows = await this.db
      .select()
      .from(schema.messages)
      .where(
        and(
          inArray(schema.messages.conversationId, ids),
          isNull(schema.messages.deletedAt),
          ne(schema.messages.contentType, "system"),
          this.notHiddenFor(userId),
          or(ilike(schema.messages.body, pattern), sql`${schema.messages.attachment}->>'name' ilike ${pattern}`),
        ),
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit);
    const messages = await this.hydrate(rows);

    // Conversations whose group name or a member's name matches.
    const all = await Promise.all(ids.map((id) => this.loadConversation(userId, id)));
    const needle = q.toLowerCase();
    const conversations = all.filter((c): c is Conversation => {
      if (!c) return false;
      if (c.name && c.name.toLowerCase().includes(needle)) return true;
      return c.members.some((m) => m.id !== userId && (m.displayName.toLowerCase().includes(needle) || (m.username ?? "").toLowerCase().includes(needle)));
    });
    return { messages, conversations };
  }

  async markReceipt(userId: string, messageId: string, kind: ReceiptKind): Promise<{ message: Message; at: Date } | null> {
    const row = await this.row(messageId);
    if (row.senderId === userId) return null;
    await this.assertMember(userId, row.conversationId);

    const at = new Date();
    const patch = kind === "read" ? { readAt: at, deliveredAt: at } : { deliveredAt: at };
    await this.db
      .insert(schema.messageReceipts)
      .values({ messageId, userId, ...patch })
      .onConflictDoUpdate({
        target: [schema.messageReceipts.messageId, schema.messageReceipts.userId],
        set:
          kind === "read"
            ? { readAt: at, deliveredAt: sql`coalesce(${schema.messageReceipts.deliveredAt}, ${at})` }
            : { deliveredAt: sql`coalesce(${schema.messageReceipts.deliveredAt}, ${at})` },
      });

    if (kind === "read") {
      await this.db
        .update(schema.conversationMembers)
        .set({ lastReadAt: row.createdAt })
        .where(
          and(
            eq(schema.conversationMembers.conversationId, row.conversationId),
            eq(schema.conversationMembers.userId, userId),
            sql`(${schema.conversationMembers.lastReadAt} is null or ${schema.conversationMembers.lastReadAt} < ${row.createdAt})`,
          ),
        );
    }
    return { message: (await this.hydrate([row]))[0]!, at };
  }

  // ---------- internals ----------

  private async row(messageId: string): Promise<MessageRow> {
    const [row] = await this.db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).limit(1);
    if (!row) throw notFound("Message");
    return row;
  }

  private notHiddenFor(userId: string) {
    return notInArray(
      schema.messages.id,
      this.db.select({ id: schema.messageHidden.messageId }).from(schema.messageHidden).where(eq(schema.messageHidden.userId, userId)),
    );
  }

  private async systemMessage(db: DbOrTx, conversationId: string, actorId: string, body: string): Promise<void> {
    await db.insert(schema.messages).values({ conversationId, senderId: actorId, body, contentType: "system" });
  }

  /** Attaches reactions, reply previews and signed attachment links to raw rows. */
  private async hydrate(rows: MessageRow[]): Promise<Message[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const reactionRows = await this.db.select().from(schema.messageReactions).where(inArray(schema.messageReactions.messageId, ids));
    const reactions = new Map<string, Reaction[]>();
    for (const r of reactionRows) {
      const list = reactions.get(r.messageId) ?? [];
      list.push({ userId: r.userId, emoji: r.emoji });
      reactions.set(r.messageId, list);
    }
    const replyIds = [...new Set(rows.flatMap((r) => (r.replyToId ? [r.replyToId] : [])))];
    const replies = new Map<string, ReplyPreview>();
    if (replyIds.length > 0) {
      const targets = await this.db.select().from(schema.messages).where(inArray(schema.messages.id, replyIds));
      for (const t of targets) {
        replies.set(t.id, {
          id: t.id,
          senderId: t.senderId,
          body: t.deletedAt ? "" : t.body || previewOf({ body: "", contentType: t.contentType as ContentType, deleted: false }),
          contentType: t.contentType as ContentType,
          deleted: !!t.deletedAt,
        });
      }
    }
    return rows.map((row) => this.toMessage(row, reactions.get(row.id) ?? [], row.replyToId ? replies.get(row.replyToId) : undefined));
  }

  private toMessage(row: MessageRow, reactions: Reaction[], replyTo?: ReplyPreview): Message {
    const deleted = !!row.deletedAt;
    return {
      id: row.id,
      conversationId: row.conversationId,
      senderId: row.senderId,
      body: deleted ? "" : row.body,
      contentType: row.contentType as ContentType,
      ...(row.attachment && !deleted ? { attachment: this.media.toAttachment(row.attachment) } : {}),
      ...(replyTo ? { replyTo } : {}),
      reactions,
      ...(row.editedAt && !deleted ? { editedAt: row.editedAt.toISOString() } : {}),
      deleted,
      createdAt: row.createdAt.toISOString(),
      ...(row.clientId ? { clientId: row.clientId } : {}),
    };
  }

  /** Delivery state for the caller's own messages, so ticks survive a reload. */
  private async receiptSummaries(userId: string, conversationId: string, rows: MessageRow[]): Promise<Map<string, ReceiptSummary>> {
    const own = rows.filter((r) => r.senderId === userId).map((r) => r.id);
    const out = new Map<string, ReceiptSummary>();
    if (own.length === 0) return out;

    const recipients = (await this.memberIds(conversationId)).filter((id) => id !== userId).length;
    const receiptRows = await this.db.select().from(schema.messageReceipts).where(inArray(schema.messageReceipts.messageId, own));
    const byMessage = new Map<string, typeof receiptRows>();
    for (const r of receiptRows) {
      const list = byMessage.get(r.messageId) ?? [];
      list.push(r);
      byMessage.set(r.messageId, list);
    }
    const latestWhenComplete = (times: number[]) =>
      recipients > 0 && times.length >= recipients ? new Date(Math.max(...times)).toISOString() : null;

    for (const id of own) {
      const list = byMessage.get(id) ?? [];
      out.set(id, {
        deliveredAt: latestWhenComplete(list.flatMap((r) => (r.deliveredAt ? [r.deliveredAt.getTime()] : []))),
        readAt: latestWhenComplete(list.flatMap((r) => (r.readAt ? [r.readAt.getTime()] : []))),
      });
    }
    return out;
  }

  private async roleOf(userId: string, conversationId: string): Promise<MemberRole | null> {
    const [m] = await this.db
      .select({ role: schema.conversationMembers.role })
      .from(schema.conversationMembers)
      .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, userId)))
      .limit(1);
    return m ? (m.role as MemberRole) : null;
  }

  private async assertMember(userId: string, conversationId: string): Promise<void> {
    if (!(await this.roleOf(userId, conversationId))) throw forbidden("Not a member of this conversation");
  }

  private async assertAdmin(userId: string, conversationId: string): Promise<void> {
    const role = await this.roleOf(userId, conversationId);
    if (!role) throw forbidden("Not a member of this conversation");
    if (role !== "admin") throw forbidden("Only group admins can do that");
  }

  private async loadConversation(userId: string, conversationId: string): Promise<Conversation | null> {
    const [conv] = await this.db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).limit(1);
    if (!conv) return null;

    const memberRows = await this.db
      .select({ user: schema.users, role: schema.conversationMembers.role, lastReadAt: schema.conversationMembers.lastReadAt })
      .from(schema.conversationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.conversationMembers.userId))
      .where(eq(schema.conversationMembers.conversationId, conversationId))
      .orderBy(schema.conversationMembers.joinedAt);
    const me = memberRows.find((r) => r.user.id === userId);
    if (!me) return null;

    const [last] = await this.db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.conversationId, conversationId), this.notHiddenFor(userId)))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1);

    const unreadConditions = [eq(schema.messages.conversationId, conversationId), ne(schema.messages.senderId, userId), ne(schema.messages.contentType, "system")];
    if (me.lastReadAt) unreadConditions.push(gt(schema.messages.createdAt, me.lastReadAt));
    const [unread] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(and(...unreadConditions));

    return {
      id: conv.id,
      type: conv.type,
      name: conv.name,
      avatarUrl: conv.avatarMediaId ? this.media.signedUrl(conv.avatarMediaId) : null,
      createdAt: conv.createdAt.toISOString(),
      members: memberRows.map((r) => ({ ...toPublicUser(r.user), role: r.role as MemberRole })),
      lastMessage: last ? (await this.hydrate([last]))[0]! : null,
      unreadCount: unread?.count ?? 0,
    };
  }
}
