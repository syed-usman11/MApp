import { z } from "zod";
import { Id, PublicUser } from "./common.js";
import { AttachmentInput, ContentType, Conversation, Message } from "./chat.js";

export const ReceiptKind = z.enum(["delivered", "read"]);
export type ReceiptKind = z.infer<typeof ReceiptKind>;

export const DeleteScope = z.enum(["me", "everyone"]);
export type DeleteScope = z.infer<typeof DeleteScope>;

/** Opaque WebRTC payloads. The server relays them without inspection. */
const Sdp = z.object({ type: z.string(), sdp: z.string() });
const IceCandidate = z.object({
  candidate: z.string(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
});

/** Messages the client sends to the server over the socket. */
export const ClientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string() }),
  z.object({ type: z.literal("ping") }),
  z.object({
    type: z.literal("message.send"),
    clientId: z.string().min(1).max(64),
    conversationId: Id,
    body: z.string().max(8000).default(""),
    contentType: ContentType.exclude(["system"]).default("text"),
    attachment: AttachmentInput.optional(),
    replyToId: Id.optional(),
  }),
  z.object({
    type: z.literal("message.edit"),
    messageId: Id,
    body: z.string().min(1).max(8000),
  }),
  z.object({
    type: z.literal("message.delete"),
    messageId: Id,
    scope: DeleteScope,
  }),
  z.object({
    type: z.literal("reaction"),
    messageId: Id,
    /** null clears the caller's reaction. */
    emoji: z.string().min(1).max(16).nullable(),
  }),
  z.object({
    type: z.literal("message.ack"),
    messageId: Id,
    kind: ReceiptKind,
  }),
  z.object({
    type: z.literal("typing"),
    conversationId: Id,
    isTyping: z.boolean(),
  }),
  z.object({
    type: z.literal("call.invite"),
    conversationId: Id,
    sdp: Sdp,
  }),
  z.object({ type: z.literal("call.answer"), callId: Id, sdp: Sdp }),
  z.object({ type: z.literal("call.ice"), callId: Id, candidate: IceCandidate }),
  /** Tell the other side we paused the call. */
  z.object({ type: z.literal("call.hold"), callId: Id, onHold: z.boolean() }),
  /** Renegotiation after an ICE restart: an offer or an answer, relayed as-is. */
  z.object({ type: z.literal("call.sdp"), callId: Id, sdp: Sdp }),
  z.object({
    type: z.literal("call.end"),
    callId: Id,
    reason: z.enum(["hangup", "declined", "busy", "failed"]).default("hangup"),
  }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

/** Messages the server pushes to the client. */
export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), userId: Id, deviceId: Id }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("message.new"), message: Message }),
  z.object({ type: z.literal("message.sent"), clientId: z.string(), message: Message }),
  z.object({ type: z.literal("message.edited"), message: Message }),
  z.object({ type: z.literal("message.deleted"), messageId: Id, conversationId: Id }),
  z.object({ type: z.literal("reaction"), messageId: Id, conversationId: Id, userId: Id, emoji: z.string().nullable() }),
  z.object({
    type: z.literal("receipt"),
    messageId: Id,
    conversationId: Id,
    userId: Id,
    kind: ReceiptKind,
    at: z.string(),
  }),
  z.object({
    type: z.literal("typing"),
    conversationId: Id,
    userId: Id,
    isTyping: z.boolean(),
  }),
  z.object({ type: z.literal("presence"), userId: Id, online: z.boolean() }),
  /** Group created, renamed, or membership changed. Members who were removed get `removed: true`. */
  z.object({ type: z.literal("conversation.updated"), conversation: Conversation, removed: z.boolean().default(false) }),
  z.object({ type: z.literal("call.incoming"), callId: Id, conversationId: Id, from: PublicUser, sdp: Sdp }),
  z.object({ type: z.literal("call.ringing"), callId: Id, conversationId: Id }),
  z.object({ type: z.literal("call.answered"), callId: Id, sdp: Sdp }),
  z.object({ type: z.literal("call.ice"), callId: Id, candidate: IceCandidate }),
  z.object({ type: z.literal("call.hold"), callId: Id, userId: Id, onHold: z.boolean() }),
  z.object({ type: z.literal("call.sdp"), callId: Id, sdp: Sdp }),
  z.object({
    type: z.literal("call.ended"),
    callId: Id,
    reason: z.enum(["hangup", "declined", "busy", "failed", "timeout", "offline"]),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
