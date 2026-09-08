import { create } from "zustand";
import type { Conversation, ListConversationsResponse, ListMessagesResponse, Message, ServerEvent } from "@mapp/protocol";
import { api } from "./api";

export type LocalMessage = Message & { pending?: boolean; failed?: boolean };

export interface Receipt {
  deliveredAt?: string;
  readAt?: string;
}

const TYPING_TTL_MS = 4000;

export interface ChatState {
  connected: boolean;
  conversations: Record<string, Conversation>;
  /** Ascending by createdAt, per conversation. */
  messages: Record<string, LocalMessage[]>;
  /** Receipts on messages I sent, by message id. */
  receipts: Record<string, Receipt>;
  presence: Record<string, boolean>;
  /** conversationId -> userId -> expiry timestamp. */
  typing: Record<string, Record<string, number>>;

  setConnected(connected: boolean): void;
  loadConversations(): Promise<void>;
  openDirect(username: string): Promise<Conversation>;
  loadMessages(conversationId: string): Promise<void>;
  addPending(conversationId: string, clientId: string, body: string, senderId: string): void;
  markFailed(conversationId: string, clientId: string): void;
  clearUnread(conversationId: string): void;
  handleEvent(event: ServerEvent): void;
  reset(): void;
}

function upsertMessage(list: LocalMessage[], message: LocalMessage): LocalMessage[] {
  const idx = list.findIndex((m) => m.id === message.id || (message.clientId && m.clientId === message.clientId));
  if (idx === -1) return [...list, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const next = list.slice();
  next[idx] = message;
  return next;
}

export const useChat = create<ChatState>((set, get) => ({
  connected: false,
  conversations: {},
  messages: {},
  receipts: {},
  presence: {},
  typing: {},

  setConnected(connected) {
    set({ connected });
  },

  async loadConversations() {
    const res = await api<ListConversationsResponse>("/v1/conversations");
    const conversations: Record<string, Conversation> = {};
    for (const c of res.conversations) conversations[c.id] = c;
    set({ conversations });
  },

  async openDirect(username) {
    const conv = await api<Conversation>("/v1/conversations/direct", { body: { username } });
    set((s) => ({ conversations: { ...s.conversations, [conv.id]: conv } }));
    return conv;
  },

  async loadMessages(conversationId) {
    const res = await api<ListMessagesResponse>(`/v1/conversations/${conversationId}/messages?limit=100`);
    set((s) => {
      const pending = (s.messages[conversationId] ?? []).filter((m) => m.pending || m.failed);
      const receipts = { ...s.receipts };
      for (const m of res.messages) {
        if (m.receipt) receipts[m.id] = { deliveredAt: m.receipt.deliveredAt ?? undefined, readAt: m.receipt.readAt ?? undefined };
      }
      return { messages: { ...s.messages, [conversationId]: [...res.messages, ...pending] }, receipts };
    });
  },

  addPending(conversationId, clientId, body, senderId) {
    const message: LocalMessage = {
      id: `pending:${clientId}`,
      clientId,
      conversationId,
      senderId,
      body,
      contentType: "text",
      createdAt: new Date().toISOString(),
      pending: true,
    };
    set((s) => ({ messages: { ...s.messages, [conversationId]: upsertMessage(s.messages[conversationId] ?? [], message) } }));
  },

  markFailed(conversationId, clientId) {
    set((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: (s.messages[conversationId] ?? []).map((m) =>
          m.clientId === clientId && m.pending ? { ...m, pending: false, failed: true } : m,
        ),
      },
    }));
  },

  clearUnread(conversationId) {
    set((s) => {
      const conv = s.conversations[conversationId];
      if (!conv || conv.unreadCount === 0) return {};
      return { conversations: { ...s.conversations, [conversationId]: { ...conv, unreadCount: 0 } } };
    });
  },

  handleEvent(event) {
    const s = get();
    switch (event.type) {
      case "message.sent":
      case "message.new": {
        const { message } = event;
        const conv = s.conversations[message.conversationId];
        const isMine = event.type === "message.sent";
        set({
          messages: { ...s.messages, [message.conversationId]: upsertMessage(s.messages[message.conversationId] ?? [], message) },
          conversations: conv
            ? {
                ...s.conversations,
                [message.conversationId]: {
                  ...conv,
                  lastMessage: message,
                  unreadCount: isMine ? conv.unreadCount : conv.unreadCount + 1,
                },
              }
            : s.conversations,
        });
        if (!conv) void get().loadConversations();
        return;
      }
      case "receipt": {
        const prev = s.receipts[event.messageId] ?? {};
        const next: Receipt =
          event.kind === "read"
            ? { deliveredAt: prev.deliveredAt ?? event.at, readAt: event.at }
            : { ...prev, deliveredAt: prev.deliveredAt ?? event.at };
        set({ receipts: { ...s.receipts, [event.messageId]: next } });
        return;
      }
      case "typing": {
        const forConv = { ...(s.typing[event.conversationId] ?? {}) };
        if (event.isTyping) forConv[event.userId] = Date.now() + TYPING_TTL_MS;
        else delete forConv[event.userId];
        set({ typing: { ...s.typing, [event.conversationId]: forConv } });
        return;
      }
      case "presence":
        set({ presence: { ...s.presence, [event.userId]: event.online } });
        return;
      default:
        return;
    }
  },

  reset() {
    set({ connected: false, conversations: {}, messages: {}, receipts: {}, presence: {}, typing: {} });
  },
}));

/** Who is typing in a conversation right now, ignoring expired indicators. */
export function activeTypers(typing: Record<string, number> | undefined): string[] {
  if (!typing) return [];
  const now = Date.now();
  return Object.entries(typing)
    .filter(([, until]) => until > now)
    .map(([userId]) => userId);
}
