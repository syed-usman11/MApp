import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { ClientEvent, type Conversation, type ServerEvent } from "@mapp/protocol";
import type { AuthContext, TokenService } from "../auth/tokens.js";
import type { CallService } from "../calls/service.js";
import { previewOf, type ChatService } from "../chat/service.js";
import { AppError } from "../errors.js";
import type { PushService } from "../push/service.js";
import type { Hub } from "./hub.js";

const AUTH_TIMEOUT_MS = 5000;

type EndReason = Extract<ServerEvent, { type: "call.ended" }>["reason"];

export interface GatewayDeps {
  hub: Hub;
  chat: ChatService;
  tokens: TokenService;
  push: PushService;
  calls: CallService;
}

export function registerGateway(app: FastifyInstance, deps: GatewayDeps) {
  const { hub, chat, tokens, push, calls } = deps;

  /** Who to name in a notification and what to call the chat. */
  function labelsFor(conversation: Conversation, senderId: string): { title: string; senderName: string } {
    const sender = conversation.members.find((m) => m.id === senderId);
    const senderName = sender?.displayName ?? "Someone";
    return { title: conversation.type === "group" ? (conversation.name ?? "Group") : senderName, senderName };
  }

  /** Notify members whose devices have no live socket. Never blocks the sender. */
  async function pushNewMessage(senderId: string, conversationId: string, members: string[], preview: string) {
    const offline = members.filter((id) => id !== senderId && !hub.isOnline(id));
    if (offline.length === 0) return;
    const conversation = await chat.conversationFor(senderId, conversationId);
    const { title, senderName } = labelsFor(conversation, senderId);
    const body = conversation.type === "group" ? `${senderName}: ${preview}` : preview;
    for (const userId of offline) {
      const badge = await chat.unreadTotal(userId).catch(() => undefined);
      push.notify([userId], { title, body, badge, data: { conversationId, kind: "message" } });
    }
  }

  async function endCall(callId: string, status: "ended" | "missed" | "declined" | "failed", reason: EndReason) {
    const call = await calls.end(callId, status);
    if (!call) return;
    hub.sendMany([call.callerId, call.calleeId], { type: "call.ended", callId, reason });
  }

  app.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
    let auth: AuthContext | null = null;
    const send = (event: ServerEvent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    };
    const fail = (code: string, message: string) => send({ type: "error", code, message });

    const authTimer = setTimeout(() => {
      if (!auth) socket.close(4401, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    socket.on("message", async (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return fail("BAD_JSON", "Payload must be JSON");
      }
      const ev = ClientEvent.safeParse(parsed);
      if (!ev.success) return fail("BAD_EVENT", ev.error.issues[0]?.message ?? "Invalid event");
      const event = ev.data;

      try {
        if (!auth) {
          if (event.type !== "auth") {
            fail("UNAUTHENTICATED", "Send an auth event first");
            return socket.close(4401, "unauthenticated");
          }
          auth = await tokens.verifyAccess(event.token);
          clearTimeout(authTimer);
          const { firstConnection } = hub.add(auth.userId, socket);
          send({ type: "ready", userId: auth.userId, deviceId: auth.deviceId });
          if (firstConnection) {
            hub.sendMany(await chat.peerIds(auth.userId), { type: "presence", userId: auth.userId, online: true });
          }
          for (const peer of await chat.peerIds(auth.userId)) {
            if (hub.isOnline(peer)) send({ type: "presence", userId: peer, online: true });
          }
          return;
        }
        const me = auth.userId;

        switch (event.type) {
          case "auth":
            return fail("ALREADY_AUTHENTICATED", "Socket is already authenticated");
          case "ping":
            return send({ type: "pong" });

          case "message.send": {
            const message = await chat.sendMessage(me, event);
            const members = await chat.memberIds(event.conversationId);
            // Sender's own sockets (including this one) get the reconciled message.
            hub.send(me, { type: "message.sent", clientId: event.clientId, message });
            hub.sendMany(
              members.filter((m) => m !== me),
              { type: "message.new", message },
            );
            void pushNewMessage(me, event.conversationId, members, previewOf(message)).catch((err) => req.log.warn({ err }, "push failed"));
            return;
          }
          case "message.edit": {
            const message = await chat.editMessage(me, event.messageId, event.body);
            hub.sendMany(await chat.memberIds(message.conversationId), { type: "message.edited", message });
            return;
          }
          case "message.delete": {
            const { message, broadcast } = await chat.deleteMessage(me, event.messageId, event.scope);
            if (broadcast) {
              hub.sendMany(await chat.memberIds(message.conversationId), { type: "message.deleted", messageId: message.id, conversationId: message.conversationId });
            } else {
              hub.send(me, { type: "message.deleted", messageId: message.id, conversationId: message.conversationId });
            }
            return;
          }
          case "reaction": {
            const { conversationId } = await chat.react(me, event.messageId, event.emoji);
            hub.sendMany(await chat.memberIds(conversationId), { type: "reaction", messageId: event.messageId, conversationId, userId: me, emoji: event.emoji });
            return;
          }
          case "message.ack": {
            const res = await chat.markReceipt(me, event.messageId, event.kind);
            if (!res) return;
            hub.send(res.message.senderId, {
              type: "receipt",
              messageId: res.message.id,
              conversationId: res.message.conversationId,
              userId: me,
              kind: event.kind,
              at: res.at.toISOString(),
            });
            return;
          }
          case "typing": {
            const members = await chat.memberIds(event.conversationId);
            if (!members.includes(me)) return fail("FORBIDDEN", "Not a member");
            hub.sendMany(
              members.filter((m) => m !== me),
              { type: "typing", conversationId: event.conversationId, userId: me, isTyping: event.isTyping },
            );
            return;
          }

          case "call.invite": {
            const conversation = await chat.conversationFor(me, event.conversationId);
            if (conversation.type !== "direct") return fail("GROUP_CALL", "Voice calls are one-to-one for now");
            const callee = conversation.members.find((m) => m.id !== me);
            const caller = conversation.members.find((m) => m.id === me);
            if (!callee || !caller) return fail("NO_PEER", "Nobody to call");
            const call = await calls.start(me, event.conversationId, callee.id, (timedOut) => {
              void endCall(timedOut.id, "missed", "timeout");
              push.notify([timedOut.calleeId], { title: caller.displayName, body: "Missed voice call", data: { conversationId: event.conversationId, kind: "missed-call" } });
            });
            send({ type: "call.ringing", callId: call.id, conversationId: event.conversationId });
            const delivered = hub.send(callee.id, { type: "call.incoming", callId: call.id, conversationId: event.conversationId, from: caller, sdp: event.sdp });
            if (delivered === 0) {
              // Wake the phone; the app reconnects and the caller keeps ringing until the timeout.
              push.notify([callee.id], { title: caller.displayName, body: "Incoming voice call", channelId: "calls", data: { conversationId: event.conversationId, kind: "call", callId: call.id } });
            }
            return;
          }
          case "call.answer": {
            const call = await calls.answer(event.callId, me);
            hub.send(call.callerId, { type: "call.answered", callId: call.id, sdp: event.sdp });
            return;
          }
          case "call.ice": {
            const call = calls.get(event.callId);
            if (!call || (call.callerId !== me && call.calleeId !== me)) return;
            hub.send(call.callerId === me ? call.calleeId : call.callerId, { type: "call.ice", callId: call.id, candidate: event.candidate });
            return;
          }
          case "call.sdp": {
            const call = calls.get(event.callId);
            if (!call || (call.callerId !== me && call.calleeId !== me)) return;
            hub.send(call.callerId === me ? call.calleeId : call.callerId, { type: "call.sdp", callId: call.id, sdp: event.sdp });
            return;
          }
          case "call.hold": {
            const call = calls.get(event.callId);
            if (!call || (call.callerId !== me && call.calleeId !== me)) return;
            hub.send(call.callerId === me ? call.calleeId : call.callerId, { type: "call.hold", callId: call.id, userId: me, onHold: event.onHold });
            return;
          }
          case "call.end": {
            const call = calls.get(event.callId);
            if (!call || (call.callerId !== me && call.calleeId !== me)) return;
            const status = event.reason === "declined" ? "declined" : event.reason === "failed" ? "failed" : call.answered ? "ended" : call.callerId === me ? "missed" : "declined";
            await endCall(call.id, status, event.reason);
            return;
          }
        }
      } catch (err) {
        if (err instanceof AppError) {
          fail(err.code, err.message);
          if (err.status === 401) socket.close(4401, "unauthenticated");
          return;
        }
        req.log.error({ err }, "websocket handler error");
        fail("INTERNAL", "Something went wrong");
      }
    });

    socket.on("close", async () => {
      clearTimeout(authTimer);
      if (!auth) return;
      const { lastConnection } = hub.remove(auth.userId, socket);
      if (lastConnection) {
        try {
          hub.sendMany(await chat.peerIds(auth.userId), { type: "presence", userId: auth.userId, online: false });
          const call = calls.activeFor(auth.userId);
          if (call) await endCall(call.id, call.answered ? "ended" : "failed", "offline");
        } catch (err) {
          req.log.warn({ err }, "disconnect cleanup failed");
        }
      }
    });
  });
}
