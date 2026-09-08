import { create } from "zustand";
import type { PublicUser, ServerEvent } from "@mapp/protocol";
import { sendSocketEvent } from "./wsSend";
import { getRtc, iceServers, type RtcIceCandidate, type RtcPeerConnection, type RtcSessionDescription, type RtcStream } from "./webrtc";

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  conversationId: string | null;
  peer: PublicUser | null;
  /** When the media connection came up; drives the timer. */
  connectedAt: number | null;
  muted: boolean;
  endReason: string | null;
  /** Why a call could not start, e.g. WebRTC missing in Expo Go. */
  error: string | null;

  startCall(conversationId: string, peer: PublicUser): Promise<void>;
  accept(): Promise<void>;
  decline(): void;
  hangup(): void;
  toggleMute(): void;
  dismiss(): void;
  handleEvent(event: ServerEvent): void;
}

interface Session {
  pc: RtcPeerConnection;
  local: RtcStream;
  stopRemote: (() => void) | null;
  /** ICE candidates found before the server assigned a call id (caller side). */
  pendingLocalIce: RtcIceCandidate[];
  /** Remote candidates that arrived before the remote description was set. */
  pendingRemoteIce: RtcIceCandidate[];
  offer: RtcSessionDescription | null;
}

let session: Session | null = null;
let incomingOffer: RtcSessionDescription | null = null;

function teardown() {
  if (session) {
    try {
      session.pc.onicecandidate = null;
      session.pc.onconnectionstatechange = null;
      session.pc.ontrack = null;
      session.pc.close();
    } catch {
      // already closed
    }
    for (const t of session.local.getTracks()) t.stop();
    session.stopRemote?.();
  }
  session = null;
  incomingOffer = null;
}

export const useCall = create<CallState>((set, get) => {
  function newSession(local: RtcStream): Session {
    const rtc = getRtc()!;
    const pc = rtc.createPeerConnection({ iceServers: iceServers() });
    const s: Session = { pc, local, stopRemote: null, pendingLocalIce: [], pendingRemoteIce: [], offer: null };
    for (const track of local.getTracks()) pc.addTrack(track, local);
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const { callId } = get();
      if (callId) sendSocketEvent({ type: "call.ice", callId, candidate: toIce(candidate) });
      else s.pendingLocalIce.push(candidate);
    };
    pc.ontrack = ({ streams }) => {
      if (streams[0] && !s.stopRemote) s.stopRemote = rtc.playRemote(streams[0]);
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected" && get().phase !== "active") set({ phase: "active", connectedAt: Date.now() });
      if (state === "failed") {
        const { callId } = get();
        if (callId) sendSocketEvent({ type: "call.end", callId, reason: "failed" });
        finish("failed");
      }
    };
    return s;
  }

  function finish(reason: string) {
    teardown();
    set({ phase: "ended", endReason: reason, connectedAt: null, muted: false });
  }

  async function flushRemoteIce() {
    if (!session) return;
    const queued = session.pendingRemoteIce.splice(0);
    for (const c of queued) await session.pc.addIceCandidate(c).catch(() => undefined);
  }

  return {
    phase: "idle",
    callId: null,
    conversationId: null,
    peer: null,
    connectedAt: null,
    muted: false,
    endReason: null,
    error: null,

    async startCall(conversationId, peer) {
      const rtc = getRtc();
      if (!rtc) {
        set({ error: "Voice calls need the installed app or the web version. They are not available inside Expo Go." });
        return;
      }
      if (get().phase !== "idle" && get().phase !== "ended") return;
      set({ phase: "outgoing", conversationId, peer, callId: null, endReason: null, error: null, muted: false, connectedAt: null });
      try {
        const local = await rtc.getAudioStream();
        session = newSession(local);
        const offer = await session.pc.createOffer({ offerToReceiveAudio: true });
        await session.pc.setLocalDescription(offer);
        if (!sendSocketEvent({ type: "call.invite", conversationId, sdp: { type: offer.type, sdp: offer.sdp } })) {
          finish("offline");
        }
      } catch (err) {
        teardown();
        const message = err instanceof Error ? err.message : "";
        const denied = /denied|not allowed|permission/i.test(message);
        set({ phase: "ended", endReason: "failed", error: denied ? "Microphone access was denied" : message || "Could not access the microphone" });
      }
    },

    async accept() {
      const rtc = getRtc();
      const { callId } = get();
      if (!rtc || !callId || !incomingOffer) return;
      try {
        const local = await rtc.getAudioStream();
        session = newSession(local);
        set({ phase: "connecting", muted: false });
        await session.pc.setRemoteDescription(incomingOffer);
        await flushRemoteIce();
        const answer = await session.pc.createAnswer();
        await session.pc.setLocalDescription(answer);
        sendSocketEvent({ type: "call.answer", callId, sdp: { type: answer.type, sdp: answer.sdp } });
      } catch (err) {
        sendSocketEvent({ type: "call.end", callId, reason: "failed" });
        teardown();
        set({ phase: "ended", endReason: "failed", error: err instanceof Error ? err.message : "Could not access the microphone" });
      }
    },

    decline() {
      const { callId } = get();
      if (callId) sendSocketEvent({ type: "call.end", callId, reason: "declined" });
      finish("declined");
    },

    hangup() {
      const { callId } = get();
      if (callId) sendSocketEvent({ type: "call.end", callId, reason: "hangup" });
      finish("hangup");
    },

    toggleMute() {
      if (!session) return;
      const muted = !get().muted;
      for (const t of session.local.getAudioTracks()) t.enabled = !muted;
      set({ muted });
    },

    dismiss() {
      if (get().phase === "ended") set({ phase: "idle", callId: null, conversationId: null, peer: null, endReason: null, error: null });
      else set({ error: null });
    },

    handleEvent(event) {
      switch (event.type) {
        case "call.ringing": {
          if (get().phase !== "outgoing" || !session) return;
          set({ callId: event.callId });
          for (const c of session.pendingLocalIce.splice(0)) sendSocketEvent({ type: "call.ice", callId: event.callId, candidate: toIce(c) });
          return;
        }
        case "call.incoming": {
          const { phase } = get();
          if (phase !== "idle" && phase !== "ended") {
            sendSocketEvent({ type: "call.end", callId: event.callId, reason: "busy" });
            return;
          }
          incomingOffer = event.sdp;
          set({ phase: "incoming", callId: event.callId, conversationId: event.conversationId, peer: event.from, endReason: null, error: null, connectedAt: null });
          return;
        }
        case "call.answered": {
          if (event.callId !== get().callId || !session) return;
          set({ phase: "connecting" });
          void session.pc
            .setRemoteDescription(event.sdp)
            .then(flushRemoteIce)
            .catch(() => {
              sendSocketEvent({ type: "call.end", callId: event.callId, reason: "failed" });
              finish("failed");
            });
          return;
        }
        case "call.ice": {
          if (event.callId !== get().callId) return;
          if (!session) return;
          if (session.pc.remoteDescription) void session.pc.addIceCandidate(event.candidate).catch(() => undefined);
          else session.pendingRemoteIce.push(event.candidate);
          return;
        }
        case "call.ended": {
          if (event.callId !== get().callId) return;
          finish(event.reason);
          return;
        }
        default:
          return;
      }
    },
  };
});

function toIce(c: RtcIceCandidate): RtcIceCandidate {
  return { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null };
}

export function describeEnd(reason: string | null): string {
  switch (reason) {
    case "declined":
      return "Call declined";
    case "busy":
      return "They are on another call";
    case "timeout":
      return "No answer";
    case "offline":
      return "Could not connect";
    case "failed":
      return "Call failed";
    default:
      return "Call ended";
  }
}
