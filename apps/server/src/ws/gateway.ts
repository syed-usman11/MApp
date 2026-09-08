import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { ClientEvent, type ServerEvent } from "@mapp/protocol";
import type { AuthContext, TokenService } from "../auth/tokens.js";
import type { ChatService } from "../chat/service.js";
import { AppError } from "../errors.js";
import type { Hub } from "./hub.js";

const AUTH_TIMEOUT_MS = 5000;

export function registerGateway(app: FastifyInstance, deps: { hub: Hub; chat: ChatService; tokens: TokenService }) {
  const { hub, chat, tokens } = deps;

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

        switch (event.type) {
          case "auth":
            return fail("ALREADY_AUTHENTICATED", "Socket is already authenticated");
          case "ping":
            return send({ type: "pong" });
          case "message.send": {
            const message = await chat.sendMessage(auth.userId, event);
            const members = await chat.memberIds(event.conversationId);
            // Sender's own sockets (including this one) get the reconciled message.
            hub.send(auth.userId, { type: "message.sent", clientId: event.clientId, message });
            hub.sendMany(
              members.filter((m) => m !== auth!.userId),
              { type: "message.new", message },
            );
            return;
          }
          case "message.ack": {
            const res = await chat.markReceipt(auth.userId, event.messageId, event.kind);
            if (!res) return;
            hub.send(res.message.senderId, {
              type: "receipt",
              messageId: res.message.id,
              conversationId: res.message.conversationId,
              userId: auth.userId,
              kind: event.kind,
              at: res.at.toISOString(),
            });
            return;
          }
          case "typing": {
            const members = await chat.memberIds(event.conversationId);
            if (!members.includes(auth.userId)) return fail("FORBIDDEN", "Not a member");
            hub.sendMany(
              members.filter((m) => m !== auth!.userId),
              { type: "typing", conversationId: event.conversationId, userId: auth.userId, isTyping: event.isTyping },
            );
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
        } catch (err) {
          req.log.warn({ err }, "presence fan-out failed");
        }
      }
    });
  });
}
