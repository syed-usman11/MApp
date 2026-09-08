import type { WebSocket } from "ws";
import type { ServerEvent } from "@mapp/protocol";

/**
 * In-memory registry of live sockets per user. Sufficient for a single server
 * node. For multiple nodes, replace `send` with a Redis pub/sub fan-out that
 * ends in this same local delivery.
 */
export class Hub {
  private readonly sockets = new Map<string, Set<WebSocket>>();

  add(userId: string, socket: WebSocket): { firstConnection: boolean } {
    let set = this.sockets.get(userId);
    const firstConnection = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(socket);
    return { firstConnection };
  }

  remove(userId: string, socket: WebSocket): { lastConnection: boolean } {
    const set = this.sockets.get(userId);
    if (!set) return { lastConnection: false };
    set.delete(socket);
    if (set.size === 0) {
      this.sockets.delete(userId);
      return { lastConnection: true };
    }
    return { lastConnection: false };
  }

  isOnline(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  send(userId: string, event: ServerEvent, except?: WebSocket): number {
    const set = this.sockets.get(userId);
    if (!set) return 0;
    const payload = JSON.stringify(event);
    let n = 0;
    for (const s of set) {
      if (s === except) continue;
      if (s.readyState === s.OPEN) {
        s.send(payload);
        n++;
      }
    }
    return n;
  }

  sendMany(userIds: Iterable<string>, event: ServerEvent, except?: WebSocket): void {
    for (const id of userIds) this.send(id, event, except);
  }
}
