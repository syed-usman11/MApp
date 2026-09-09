import { create } from "zustand";
import type {
  AttachmentInput,
  ContentType,
  Conversation,
  ListConversationsResponse,
  ListMessagesResponse,
  Message,
  ReplyPreview,
  SearchResponse,
  ServerEvent,
} from "@mapp/protocol";
import { api } from "./api";

export type LocalMessage = Message & { pending?: boolean; failed?: boolean };

export interface Receipt {
  deliveredAt?: string;
  readAt?: string;
}

export interface PendingInput {
  conversationId: string;
  clientId: string;
  senderId: string;
  body: string;
  contentType: Exclude<ContentType, "system">;
  attachment?: AttachmentInput & { url: string };
  replyTo?: ReplyPreview;
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
  /** Ids the user deleted "for me"; the server's confirmation removes them instead of tombstoning. */
  hiddenLocally: Record<string, true>;

  setConnected(connected: boolean): void;
  loadConversations(): Promise<void>;
  openDirect(username: string): Promise<Conversation>;
  createGroup(name: string, memberIds: string[]): Promise<Conversation>;
  updateGroup(conversationId: string, patch: { name?: string; avatarMediaId?: string | null }): Promise<Conversation>;
  addMembers(conversationId: string, memberIds: string[]): Promise<Conversation>;
  removeMember(conversationId: string, userId: string): Promise<void>;
  leaveGroup(conversationId: string, meId: string): Promise<void>;
  search(q: string): Promise<SearchResponse>;
  loadMessages(conversationId: string): Promise<void>;
  addPending(input: PendingInput): void;
  markFailed(conversationId: string, clientId: string): void;
  markHiddenLocally(messageId: string): void;
  clearUnread(conversationId: string): void;
  /** Tells the server every message in the chat has been read. Reliable over HTTP; safe to repeat. */
  markRead(conversationId: string): Promise<void>;
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

function patchMessage(messages: Record<string, LocalMessage[]>, conversationId: string, messageId: string, patch: (m: LocalMessage) => LocalMessage) {
  const list = messages[conversationId];
  if (!list) return messages;
  return { ...messages, [conversationId]: list.map((m) => (m.id === messageId ? patch(m) : m)) };
}

export const useChat = create<ChatState>((set, get) => ({
  connected: false,
  conversations: {},
  messages: {},
  receipts: {},
  presence: {},
  typing: {},
  hiddenLocally: {},

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

  async createGroup(name, memberIds) {
    const conv = await api<Conversation>("/v1/conversations/group", { body: { name, memberIds } });
    set((s) => ({ conversations: { ...s.conversations, [conv.id]: conv } }));
    return conv;
  },

  async updateGroup(conversationId, patch) {
    const conv = await api<Conversation>(`/v1/conversations/${conversationId}`, { method: "PATCH", body: patch });
    set((s) => ({ conversations: { ...s.conversations, [conv.id]: conv } }));
    return conv;
  },

  async addMembers(conversationId, memberIds) {
    const conv = await api<Conversation>(`/v1/conversations/${conversationId}/members`, { body: { memberIds } });
    set((s) => ({ conversations: { ...s.conversations, [conv.id]: conv } }));
    return conv;
  },

  async removeMember(conversationId, userId) {
    await api(`/v1/conversations/${conversationId}/members/${userId}`, { method: "DELETE" });
  },

  async leaveGroup(conversationId, meId) {
    await api(`/v1/conversations/${conversationId}/members/${meId}`, { method: "DELETE" });
    set((s) => {
      const conversations = { ...s.conversations };
      delete conversations[conversationId];
      const messages = { ...s.messages };
      delete messages[conversationId];
      return { conversations, messages };
    });
  },

  search(q) {
    return api<SearchResponse>(`/v1/search?q=${encodeURIComponent(q)}`);
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

  addPending(input) {
    const message: LocalMessage = {
      id: `pending:${input.clientId}`,
      clientId: input.clientId,
      conversationId: input.conversationId,
      senderId: input.senderId,
      body: input.body,
      contentType: input.contentType,
      ...(input.attachment ? { attachment: input.attachment } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      reactions: [],
      deleted: false,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    set((s) => ({ messages: { ...s.messages, [input.conversationId]: upsertMessage(s.messages[input.conversationId] ?? [], message) } }));
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

  markHiddenLocally(messageId) {
    set((s) => ({ hiddenLocally: { ...s.hiddenLocally, [messageId]: true } }));
  },

  async markRead(conversationId) {
    get().clearUnread(conversationId);
    await api(`/v1/conversations/${conversationId}/read`, { method: "POST", body: {} });
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
        const countsAsUnread = !isMine && message.contentType !== "system";
        set({
          messages: { ...s.messages, [message.conversationId]: upsertMessage(s.messages[message.conversationId] ?? [], message) },
          conversations: conv
            ? {
                ...s.conversations,
                [message.conversationId]: {
                  ...conv,
                  lastMessage: message,
                  unreadCount: countsAsUnread ? conv.unreadCount + 1 : conv.unreadCount,
                },
              }
            : s.conversations,
        });
        if (!conv) void get().loadConversations();
        return;
      }
      case "message.edited": {
        const { message } = event;
        const conv = s.conversations[message.conversationId];
        set({
          messages: { ...s.messages, [message.conversationId]: upsertMessage(s.messages[message.conversationId] ?? [], message) },
          conversations: conv && conv.lastMessage?.id === message.id ? { ...s.conversations, [message.conversationId]: { ...conv, lastMessage: message } } : s.conversations,
        });
        return;
      }
      case "message.deleted": {
        const { messageId, conversationId } = event;
        if (s.hiddenLocally[messageId]) {
          const hiddenLocally = { ...s.hiddenLocally };
          delete hiddenLocally[messageId];
          const list = (s.messages[conversationId] ?? []).filter((m) => m.id !== messageId);
          const conv = s.conversations[conversationId];
          set({
            hiddenLocally,
            messages: { ...s.messages, [conversationId]: list },
            conversations:
              conv && conv.lastMessage?.id === messageId ? { ...s.conversations, [conversationId]: { ...conv, lastMessage: list[list.length - 1] ?? null } } : s.conversations,
          });
          return;
        }
        const tombstone = (m: LocalMessage): LocalMessage => ({ ...m, deleted: true, body: "", attachment: undefined, reactions: [], editedAt: undefined });
        const conv = s.conversations[conversationId];
        set({
          messages: patchMessage(s.messages, conversationId, messageId, tombstone),
          conversations:
            conv && conv.lastMessage?.id === messageId ? { ...s.conversations, [conversationId]: { ...conv, lastMessage: tombstone(conv.lastMessage) } } : s.conversations,
        });
        return;
      }
      case "reaction": {
        set({
          messages: patchMessage(s.messages, event.conversationId, event.messageId, (m) => {
            const others = m.reactions.filter((r) => r.userId !== event.userId);
            return { ...m, reactions: event.emoji ? [...others, { userId: event.userId, emoji: event.emoji }] : others };
          }),
        });
        return;
      }
      case "conversation.updated": {
        const { conversation, removed } = event;
        if (removed) {
          const conversations = { ...s.conversations };
          delete conversations[conversation.id];
          const messages = { ...s.messages };
          delete messages[conversation.id];
          set({ conversations, messages });
        } else {
          set({ conversations: { ...s.conversations, [conversation.id]: conversation } });
        }
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
    set({ connected: false, conversations: {}, messages: {}, receipts: {}, presence: {}, typing: {}, hiddenLocally: {} });
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

/** Total unread across every conversation, for the tab badge and app icon. */
export function unreadTotal(conversations: Record<string, Conversation>): number {
  let n = 0;
  for (const c of Object.values(conversations)) n += c.unreadCount;
  return n;
}

/** One-line summary of a message for chat rows, replies and notifications. */
export function previewOf(message: Pick<Message, "body" | "contentType" | "deleted"> | null | undefined): string {
  if (!message) return "";
  if (message.deleted) return "This message was deleted";
  switch (message.contentType) {
    case "image":
      return message.body ? `📷 ${message.body}` : "📷 Photo";
    case "video":
      return message.body ? `🎥 ${message.body}` : "🎥 Video";
    case "audio":
      return "🎤 Voice message";
    case "file":
      return message.body ? `📎 ${message.body}` : "📎 File";
    default:
      return message.body;
  }
}

/** Display name and avatar for a conversation from the viewer's side. */
export function conversationLabel(conversation: Conversation, meId: string): { name: string; avatarUrl: string | null; peerId: string | null } {
  if (conversation.type === "group") {
    return { name: conversation.name ?? "Group", avatarUrl: conversation.avatarUrl, peerId: null };
  }
  const peer = conversation.members.find((m) => m.id !== meId) ?? conversation.members[0];
  return { name: peer?.displayName ?? "Unknown", avatarUrl: peer?.avatarUrl ?? null, peerId: peer?.id ?? null };
}
