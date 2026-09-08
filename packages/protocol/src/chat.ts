import { z } from "zod";
import { Id, PublicUser } from "./common.js";

/** Aggregate delivery state of a message the caller sent: set once every other member has delivered / read it. */
export const ReceiptSummary = z.object({
  deliveredAt: z.string().nullable(),
  readAt: z.string().nullable(),
});
export type ReceiptSummary = z.infer<typeof ReceiptSummary>;

export const Message = z.object({
  id: Id,
  conversationId: Id,
  senderId: Id,
  /** Plain text in phase 1. Becomes ciphertext when E2EE lands in phase 2. */
  body: z.string(),
  contentType: z.enum(["text"]).default("text"),
  createdAt: z.string(),
  /** Client-generated id so the sender can reconcile optimistic sends. */
  clientId: z.string().optional(),
  /** Only present on messages the requesting user sent, and only in history responses. */
  receipt: ReceiptSummary.optional(),
});
export type Message = z.infer<typeof Message>;

export const Conversation = z.object({
  id: Id,
  type: z.enum(["direct", "group"]),
  createdAt: z.string(),
  members: z.array(PublicUser),
  lastMessage: Message.nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type Conversation = z.infer<typeof Conversation>;

export const CreateDirectConversationRequest = z.object({
  username: z.string().min(1),
});
export type CreateDirectConversationRequest = z.infer<typeof CreateDirectConversationRequest>;

export const ListConversationsResponse = z.object({
  conversations: z.array(Conversation),
});
export type ListConversationsResponse = z.infer<typeof ListConversationsResponse>;

export const ListMessagesQuery = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>;

export const ListMessagesResponse = z.object({
  messages: z.array(Message),
  hasMore: z.boolean(),
});
export type ListMessagesResponse = z.infer<typeof ListMessagesResponse>;

export const LookupUserQuery = z.object({
  username: z.string().min(1),
});
export type LookupUserQuery = z.infer<typeof LookupUserQuery>;
