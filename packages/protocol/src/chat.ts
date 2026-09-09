import { z } from "zod";
import { Id, PublicUser } from "./common.js";

/** Aggregate delivery state of a message the caller sent: set once every other member has delivered / read it. */
export const ReceiptSummary = z.object({
  deliveredAt: z.string().nullable(),
  readAt: z.string().nullable(),
});
export type ReceiptSummary = z.infer<typeof ReceiptSummary>;

export const ContentType = z.enum(["text", "image", "video", "file", "audio", "system"]);
export type ContentType = z.infer<typeof ContentType>;

/** A photo, file or voice note attached to a message. `url` is a signed link the client can load without headers. */
export const Attachment = z.object({
  mediaId: Id,
  url: z.string(),
  mime: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type Attachment = z.infer<typeof Attachment>;

/** What the client sends when attaching an upload to a message. */
export const AttachmentInput = Attachment.omit({ url: true });
export type AttachmentInput = z.infer<typeof AttachmentInput>;

/** Enough of the quoted message to render a reply preview without a second fetch. */
export const ReplyPreview = z.object({
  id: Id,
  senderId: Id,
  body: z.string(),
  contentType: ContentType,
  deleted: z.boolean().default(false),
});
export type ReplyPreview = z.infer<typeof ReplyPreview>;

export const Reaction = z.object({
  userId: Id,
  emoji: z.string().min(1).max(16),
});
export type Reaction = z.infer<typeof Reaction>;

export const Message = z.object({
  id: Id,
  conversationId: Id,
  senderId: Id,
  /** Plain text, or the caption for an attachment. Empty when deleted for everyone. */
  body: z.string(),
  contentType: ContentType.default("text"),
  attachment: Attachment.optional(),
  replyTo: ReplyPreview.optional(),
  reactions: z.array(Reaction).default([]),
  editedAt: z.string().optional(),
  /** Set when the sender deleted it for everyone; the client renders a tombstone. */
  deleted: z.boolean().default(false),
  createdAt: z.string(),
  /** Client-generated id so the sender can reconcile optimistic sends. */
  clientId: z.string().optional(),
  /** Only present on messages the requesting user sent, and only in history responses. */
  receipt: ReceiptSummary.optional(),
});
export type Message = z.infer<typeof Message>;

export const MemberRole = z.enum(["admin", "member"]);
export type MemberRole = z.infer<typeof MemberRole>;

export const Member = PublicUser.extend({ role: MemberRole.default("member"), /** Live at the moment the conversation was served. */ online: z.boolean().default(false) });
export type Member = z.infer<typeof Member>;

export const Conversation = z.object({
  id: Id,
  type: z.enum(["direct", "group"]),
  /** Groups only. */
  name: z.string().nullable().default(null),
  avatarUrl: z.string().nullable().default(null),
  createdAt: z.string(),
  members: z.array(Member),
  lastMessage: Message.nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type Conversation = z.infer<typeof Conversation>;

export const CreateDirectConversationRequest = z.object({
  username: z.string().min(1),
});
export type CreateDirectConversationRequest = z.infer<typeof CreateDirectConversationRequest>;

export const CreateGroupRequest = z.object({
  name: z.string().trim().min(1).max(64),
  memberIds: z.array(Id).min(1).max(256),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequest>;

export const UpdateGroupRequest = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  avatarMediaId: Id.nullable().optional(),
});
export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequest>;

export const AddMembersRequest = z.object({
  memberIds: z.array(Id).min(1).max(256),
});
export type AddMembersRequest = z.infer<typeof AddMembersRequest>;

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

export const SearchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchResponse = z.object({
  messages: z.array(Message),
  conversations: z.array(Conversation),
});
export type SearchResponse = z.infer<typeof SearchResponse>;

/** Metadata returned after a successful upload. Pass it back as the message's attachment. */
export const MediaUploadResponse = AttachmentInput.extend({ url: z.string() });
export type MediaUploadResponse = z.infer<typeof MediaUploadResponse>;

export const RegisterPushTokenRequest = z.object({
  token: z.string().min(1).max(512).nullable(),
});
export type RegisterPushTokenRequest = z.infer<typeof RegisterPushTokenRequest>;

export const CallStatus = z.enum(["ringing", "answered", "ended", "missed", "declined", "failed"]);
export type CallStatus = z.infer<typeof CallStatus>;

export const CallRecord = z.object({
  id: Id,
  conversationId: Id,
  callerId: Id,
  calleeId: Id,
  status: CallStatus,
  startedAt: z.string(),
  answeredAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** The other party, from the caller's point of view. */
  peer: PublicUser,
});
export type CallRecord = z.infer<typeof CallRecord>;

/** ICE configuration handed to clients before a call: STUN always, TURN when the server has credentials. */
export const IceServersResponse = z.object({
  iceServers: z.array(z.object({ urls: z.array(z.string()), username: z.string().optional(), credential: z.string().optional() })),
});
export type IceServersResponse = z.infer<typeof IceServersResponse>;

export const ListCallsResponse = z.object({
  calls: z.array(CallRecord),
});
export type ListCallsResponse = z.infer<typeof ListCallsResponse>;
