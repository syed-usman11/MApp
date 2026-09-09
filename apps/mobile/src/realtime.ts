import { ServerEvent, type ClientEvent } from "@mapp/protocol";
import { ensureFreshAccessToken, refreshAccessToken } from "./api";
import { useCall } from "./callStore";
import { useChat } from "./chatStore";
import { WS_URL } from "./config";
import { useSession } from "./session";
import { setSocketSender } from "./wsSend";

const PING_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;

/**
 * One socket per app. Authenticates with the access token as the first frame,
 * reconnects with backoff, refreshes the token when the server rejects it, and
 * feeds every event into the chat store.
 */
class Realtime {
  private ws: WebSocket | null = null;
  private running = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    useChat.getState().setConnected(false);
  }

  /** Receipts and reactions issued while offline; replayed once the socket is ready. */
  private readonly outbox: ClientEvent[] = [];

  send(event: ClientEvent): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
      return true;
    }
    if (event.type === "message.ack" || event.type === "reaction") {
      this.outbox.push(event);
      if (this.outbox.length > 200) this.outbox.shift();
    }
    return false;
  }

  private flushOutbox(): void {
    const queued = this.outbox.splice(0);
    for (const event of queued) this.send(event);
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    const token = await ensureFreshAccessToken();
    if (!token) {
      if (useSession.getState().status === "signedIn") this.scheduleReconnect();
      return;
    }

    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token } satisfies ClientEvent));
    };

    ws.onmessage = (msg) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      const result = ServerEvent.safeParse(parsed);
      if (!result.success) return;
      const event = result.data;

      if (event.type === "ready") {
        this.attempt = 0;
        useChat.getState().resetPresence();
        useChat.getState().setConnected(true);
        this.startPing();
        this.flushOutbox();
        useCall.getState().onSocketReady();
        return;
      }
      if (event.type === "error" && event.code === "UNAUTHENTICATED") {
        void refreshAccessToken();
        return;
      }
      if (event.type === "message.new") {
        this.send({ type: "message.ack", messageId: event.message.id, kind: "delivered" });
      }
      if (event.type.startsWith("call.")) {
        useCall.getState().handleEvent(event);
        return;
      }
      useChat.getState().handleEvent(event);
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      useChat.getState().setConnected(false);
      this.stopPing();
      if (this.running) this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows; nothing else to do here.
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ type: "ping" }), PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
  }
}

export const realtime = new Realtime();
setSocketSender((event) => realtime.send(event));
