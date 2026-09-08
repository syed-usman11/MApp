import { desc, eq, or } from "drizzle-orm";
import type { CallRecord, CallStatus } from "@mapp/protocol";
import { schema, type Db } from "../db/index.js";
import { badRequest, notFound } from "../errors.js";
import { toPublicUser } from "../users/mapper.js";

export interface ActiveCall {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  answered: boolean;
  /** Fires if nobody answers. */
  ringTimer: ReturnType<typeof setTimeout>;
}

export const RING_TIMEOUT_MS = 45_000;

/**
 * Voice-call bookkeeping. Media never touches the server: peers exchange
 * WebRTC offers, answers and ICE candidates through the socket, and this
 * class only tracks who is ringing whom and writes the call log.
 */
export class CallService {
  private readonly active = new Map<string, ActiveCall>();

  constructor(private readonly db: Db) {}

  /** The call a user is currently in or being rung on, if any. */
  activeFor(userId: string): ActiveCall | undefined {
    for (const call of this.active.values()) {
      if (call.callerId === userId || call.calleeId === userId) return call;
    }
    return undefined;
  }

  get(callId: string): ActiveCall | undefined {
    return this.active.get(callId);
  }

  async start(callerId: string, conversationId: string, calleeId: string, onTimeout: (call: ActiveCall) => void): Promise<ActiveCall> {
    if (this.activeFor(callerId)) throw badRequest("BUSY", "You are already in a call");
    if (this.activeFor(calleeId)) throw badRequest("PEER_BUSY", "They are in another call");
    const [row] = await this.db
      .insert(schema.calls)
      .values({ conversationId, callerId, calleeId, status: "ringing" })
      .returning({ id: schema.calls.id });
    const call: ActiveCall = {
      id: row!.id,
      conversationId,
      callerId,
      calleeId,
      answered: false,
      ringTimer: setTimeout(() => {
        const current = this.active.get(row!.id);
        if (current && !current.answered) onTimeout(current);
      }, RING_TIMEOUT_MS),
    };
    this.active.set(call.id, call);
    return call;
  }

  async answer(callId: string, userId: string): Promise<ActiveCall> {
    const call = this.active.get(callId);
    if (!call) throw notFound("Call");
    if (call.calleeId !== userId) throw badRequest("NOT_CALLEE", "Only the person being called can answer");
    call.answered = true;
    clearTimeout(call.ringTimer);
    await this.db.update(schema.calls).set({ status: "answered", answeredAt: new Date() }).where(eq(schema.calls.id, callId));
    return call;
  }

  /** Removes the call and records how it ended. Returns null when it was already gone. */
  async end(callId: string, status: Exclude<CallStatus, "ringing" | "answered">): Promise<ActiveCall | null> {
    const call = this.active.get(callId);
    if (!call) return null;
    clearTimeout(call.ringTimer);
    this.active.delete(callId);
    await this.db.update(schema.calls).set({ status, endedAt: new Date() }).where(eq(schema.calls.id, callId));
    return call;
  }

  /** Recent calls involving the user, newest first. */
  async history(userId: string, limit = 50): Promise<CallRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.calls)
      .where(or(eq(schema.calls.callerId, userId), eq(schema.calls.calleeId, userId)))
      .orderBy(desc(schema.calls.startedAt))
      .limit(limit);
    const out: CallRecord[] = [];
    for (const row of rows) {
      const peerId = row.callerId === userId ? row.calleeId : row.callerId;
      const [peer] = await this.db.select().from(schema.users).where(eq(schema.users.id, peerId)).limit(1);
      if (!peer) continue;
      out.push({
        id: row.id,
        conversationId: row.conversationId,
        callerId: row.callerId,
        calleeId: row.calleeId,
        status: row.status as CallStatus,
        startedAt: row.startedAt.toISOString(),
        answeredAt: row.answeredAt?.toISOString() ?? null,
        endedAt: row.endedAt?.toISOString() ?? null,
        peer: toPublicUser(peer),
      });
    }
    return out;
  }

  /** Drops every in-memory call, used on shutdown so ring timers don't keep the process alive. */
  clear(): void {
    for (const call of this.active.values()) clearTimeout(call.ringTimer);
    this.active.clear();
  }
}
