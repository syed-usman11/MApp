import type { FastifyInstance } from "fastify";
import {
  AddMembersRequest,
  CreateDirectConversationRequest,
  CreateGroupRequest,
  Id,
  ListMessagesQuery,
  RegisterPushTokenRequest,
  SearchQuery,
  UpdateGroupRequest,
} from "@mapp/protocol";
import { authOf, requireAuth } from "../auth/plugin.js";
import { AppError } from "../errors.js";
import type { TokenService } from "../auth/tokens.js";
import type { CallService } from "../calls/service.js";
import type { PushService } from "../push/service.js";
import type { Hub } from "../ws/hub.js";
import type { ChatService } from "./service.js";

export function chatRoutes(app: FastifyInstance, deps: { chat: ChatService; tokens: TokenService; hub: Hub; push: PushService; calls: CallService }) {
  const { chat, tokens, hub, push, calls } = deps;
  const auth = { preHandler: requireAuth(tokens) };

  app.get("/v1/conversations", auth, async (req) => {
    const { userId } = authOf(req);
    return { conversations: await chat.listConversations(userId) };
  });

  app.post("/v1/conversations/direct", auth, async (req) => {
    const { userId } = authOf(req);
    const body = CreateDirectConversationRequest.parse(req.body);
    return chat.getOrCreateDirect(userId, body.username);
  });

  app.post("/v1/conversations/group", auth, async (req) => {
    const { userId } = authOf(req);
    const body = CreateGroupRequest.parse(req.body);
    const conversation = await chat.createGroup(userId, body.name, body.memberIds);
    await announce(conversation.id, userId);
    return conversation;
  });

  app.get<{ Params: { id: string } }>("/v1/conversations/:id", auth, async (req) => {
    const { userId } = authOf(req);
    return chat.conversationFor(userId, Id.parse(req.params.id));
  });

  app.patch<{ Params: { id: string } }>("/v1/conversations/:id", auth, async (req) => {
    const { userId } = authOf(req);
    const conversationId = Id.parse(req.params.id);
    const body = UpdateGroupRequest.parse(req.body);
    const conversation = await chat.updateGroup(userId, conversationId, body);
    await announce(conversationId, userId);
    return conversation;
  });

  app.post<{ Params: { id: string } }>("/v1/conversations/:id/members", auth, async (req) => {
    const { userId } = authOf(req);
    const conversationId = Id.parse(req.params.id);
    const body = AddMembersRequest.parse(req.body);
    const { conversation } = await chat.addMembers(userId, conversationId, body.memberIds);
    await announce(conversationId, userId);
    return conversation;
  });

  app.delete<{ Params: { id: string; userId: string } }>("/v1/conversations/:id/members/:userId", auth, async (req) => {
    const { userId } = authOf(req);
    const conversationId = Id.parse(req.params.id);
    const targetId = Id.parse(req.params.userId);
    const { conversation, members } = await chat.removeMember(userId, conversationId, targetId);
    if (conversation) {
      for (const memberId of members) {
        const view = await chat.conversationFor(memberId, conversationId).catch(() => null);
        if (view) hub.send(memberId, { type: "conversation.updated", conversation: view, removed: false });
      }
      hub.send(targetId, { type: "conversation.updated", conversation, removed: true });
    }
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/v1/conversations/:id/messages", auth, async (req) => {
    const { userId } = authOf(req);
    const conversationId = Id.parse(req.params.id);
    return chat.listMessages(userId, conversationId, ListMessagesQuery.parse(req.query));
  });

  /** Opening a chat: mark everything read and tell each sender their ticks turned blue. */
  app.post<{ Params: { id: string } }>("/v1/conversations/:id/read", auth, async (req) => {
    const { userId } = authOf(req);
    const conversationId = Id.parse(req.params.id);
    let result: Awaited<ReturnType<typeof chat.markConversationRead>>;
    try {
      result = await chat.markConversationRead(userId, conversationId);
    } catch (err) {
      // Surface the database error text: this endpoint fails on hosted Postgres but not locally.
      req.log.error({ err }, "mark-read failed");
      if (err instanceof AppError) throw err;
      throw new AppError(500, "READ_FAILED", `mark-read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { readAt, messages } = result;
    for (const m of messages) {
      hub.send(m.senderId, { type: "receipt", messageId: m.id, conversationId, userId, kind: "read", at: readAt.toISOString() });
    }
    return { ok: true, count: messages.length };
  });

  app.get("/v1/search", auth, async (req) => {
    const { userId } = authOf(req);
    const q = SearchQuery.parse(req.query);
    return chat.search(userId, q.q, q.limit);
  });

  app.get("/v1/unread", auth, async (req) => {
    const { userId } = authOf(req);
    return { total: await chat.unreadTotal(userId) };
  });

  app.post("/v1/devices/push-token", auth, async (req) => {
    const { userId, deviceId } = authOf(req);
    const body = RegisterPushTokenRequest.parse(req.body);
    await push.registerToken(userId, deviceId, body.token);
    return { ok: true };
  });

  app.get("/v1/calls", auth, async (req) => {
    const { userId } = authOf(req);
    return { calls: await calls.history(userId) };
  });

  /** Push each member their own view of a changed conversation (unread counts differ per member). */
  async function announce(conversationId: string, actorId: string) {
    const members = await chat.memberIds(conversationId);
    for (const memberId of members) {
      const view = await chat.conversationFor(memberId, conversationId).catch(() => null);
      if (view) hub.send(memberId, { type: "conversation.updated", conversation: view, removed: false });
    }
    const conversation = await chat.conversationFor(actorId, conversationId);
    const actor = conversation.members.find((m) => m.id === actorId);
    if (conversation.type === "group" && actor) {
      const offline = members.filter((id) => id !== actorId && !hub.isOnline(id));
      push.notify(offline, {
        title: conversation.name ?? "Group",
        body: `${actor.displayName} updated the group`,
        data: { conversationId },
      });
    }
  }
}
