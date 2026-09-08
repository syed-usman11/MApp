import type { FastifyInstance } from "fastify";
import { CreateDirectConversationRequest, Id, ListMessagesQuery } from "@mapp/protocol";
import { authOf, requireAuth } from "../auth/plugin.js";
import type { TokenService } from "../auth/tokens.js";
import type { ChatService } from "./service.js";

export function chatRoutes(app: FastifyInstance, chat: ChatService, tokens: TokenService) {
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

  app.get<{ Params: { id: string } }>("/v1/conversations/:id/messages", auth, async (req) => {
    const { userId } = authOf(req);
    const conversationId = Id.parse(req.params.id);
    return chat.listMessages(userId, conversationId, ListMessagesQuery.parse(req.query));
  });
}
