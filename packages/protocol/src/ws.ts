import { z } from "zod";
import { Id } from "./common.js";
import { Message } from "./chat.js";

export const ReceiptKind = z.enum(["delivered", "read"]);
export type ReceiptKind = z.infer<typeof ReceiptKind>;

/** Messages the client sends to the server over the socket. */
export const ClientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string() }),
  z.object({ type: z.literal("ping") }),
  z.object({
    type: z.literal("message.send"),
    clientId: z.string().min(1).max(64),
    conversationId: Id,
    body: z.string().min(1).max(8000),
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
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

/** Messages the server pushes to the client. */
export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), userId: Id, deviceId: Id }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("message.new"), message: Message }),
  z.object({ type: z.literal("message.sent"), clientId: z.string(), message: Message }),
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
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
