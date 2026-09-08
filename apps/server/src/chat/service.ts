import { and, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import type { Conversation, ListMessagesQuery, Message, ReceiptKind, ReceiptSummary } from "@mapp/protocol";
import { schema, type Db } from "../db/index.js";
import { badRequest, forbidden, notFound } from "../errors.js";
import { toPublicUser } from "../users/mapper.js";

type MessageRow = typeof schema.messages.$inferSelect;

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    body: row.body,
    contentType: "text",
    createdAt: row.createdAt.toISOString(),
    ...(row.clientId ? { clientId: row.clientId } : {}),
  };
}

export class ChatService {
  constructor(private readonly db: Db) {}

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
          .values({ type: "direct", directKey })
          .returning({ id: schema.conversations.id });
        await tx.insert(schema.conversationMembers).values([
          { conversationId: conv!.id, userId },
          { conversationId: conv!.id, userId: other.id },
        ]);
        return conv!.id;
      }));

    return (await this.loadConversation(userId, conversationId))!;
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

  async listMessages(userId: string, conversationId: string, q: ListMessagesQuery): Promise<{ messages: Message[]; hasMore: boolean }> {
    await this.assertMember(userId, conversationId);
    const conditions = [eq(schema.messages.conversationId, conversationId)];
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
    return {
      messages: page.map((r) => {
        const receipt = receipts.get(r.id);
        return receipt ? { ...toMessage(r), receipt } : toMessage(r);
      }),
      hasMore,
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

  async sendMessage(userId: string, input: { conversationId: string; body: string; clientId: string }): Promise<Message> {
    await this.assertMember(userId, input.conversationId);
    const [row] = await this.db
      .insert(schema.messages)
      .values({ conversationId: input.conversationId, senderId: userId, body: input.body, clientId: input.clientId })
      .returning();
    return toMessage(row!);
  }

  async markReceipt(userId: string, messageId: string, kind: ReceiptKind): Promise<{ message: Message; at: Date } | null> {
    const [row] = await this.db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).limit(1);
    if (!row) throw notFound("Message");
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
    return { message: toMessage(row), at };
  }

  private async assertMember(userId: string, conversationId: string): Promise<void> {
    const [m] = await this.db
      .select({ userId: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(and(eq(schema.conversationMembers.conversationId, conversationId), eq(schema.conversationMembers.userId, userId)))
      .limit(1);
    if (!m) throw forbidden("Not a member of this conversation");
  }

  private async loadConversation(userId: string, conversationId: string): Promise<Conversation | null> {
    const [conv] = await this.db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).limit(1);
    if (!conv) return null;

    const memberRows = await this.db
      .select({ user: schema.users, lastReadAt: schema.conversationMembers.lastReadAt })
      .from(schema.conversationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.conversationMembers.userId))
      .where(eq(schema.conversationMembers.conversationId, conversationId));
    const me = memberRows.find((r) => r.user.id === userId);
    if (!me) return null;

    const [last] = await this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1);

    const unreadConditions = [eq(schema.messages.conversationId, conversationId), ne(schema.messages.senderId, userId)];
    if (me.lastReadAt) unreadConditions.push(gt(schema.messages.createdAt, me.lastReadAt));
    const [unread] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.messages)
      .where(and(...unreadConditions));

    return {
      id: conv.id,
      type: conv.type,
      createdAt: conv.createdAt.toISOString(),
      members: memberRows.map((r) => toPublicUser(r.user)),
      lastMessage: last ? toMessage(last) : null,
      unreadCount: unread?.count ?? 0,
    };
  }
}
