import { create } from "zustand";
import type { IceServersResponse, PublicUser, ServerEvent } from "@mapp/protocol";
import { api } from "./api";
import {
  getAudioRoute,
  getRtc,
  iceServers,
  prioritiseAudio,
  tuneOpus,
  type AudioRouteName,
  type IceServer,
  type RtcIceCandidate,
  type RtcPeerConnection,
  type RtcSessionDescription,
  type RtcStream,
} from "./webrtc";
import { sendSocketEvent } from "./wsSend";

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
export type CallQuality = "good" | "fair" | "poor";

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  conversationId: string | null;
  peer: PublicUser | null;
  /** When the media connection came up; drives the timer. */
  connectedAt: number | null;
  muted: boolean;
  /** I paused the call. */
  onHold: boolean;
  /** The other side paused the call. */
  peerOnHold: boolean;
  /** Where audio plays right now and what the phone can offer. */
  audioRoute: AudioRouteName;
  availableRoutes: AudioRouteName[];
  /** Network health from the WebRTC stats, once the call is up. */
  quality: CallQuality | null;
  /** Media dropped; an ICE restart is under way. */
  reconnecting: boolean;
  endReason: string | null;
  /** Why a call could not start, e.g. WebRTC missing in Expo Go. */
  error: string | null;

  startCall(conversationId: string, peer: PublicUser): Promise<void>;
  accept(): Promise<void>;
  decline(): void;
  hangup(): void;
  toggleMute(): void;
  toggleHold(): void;
  chooseRoute(route: AudioRouteName): Promise<void>;
  /** Cycle earpiece -> speaker -> ... for a one-tap speaker button. */
  toggleSpeaker(): Promise<void>;
  dismiss(): void;
  handleEvent(event: ServerEvent): void;
  /** Called by the socket layer after every reconnect; restarts media if it dropped meanwhile. */
  onSocketReady(): void;
}

interface Session {
  pc: RtcPeerConnection;
  local: RtcStream;
  remote: RtcStream | null;
  stopRemote: (() => void) | null;
  /** ICE candidates found before the server assigned a call id (caller side). */
  pendingLocalIce: RtcIceCandidate[];
  /** Remote candidates that arrived before the remote description was set. */
  pendingRemoteIce: RtcIceCandidate[];
  /** The caller drives ICE restarts; the callee only answers them (avoids offer glare). */
  isCaller: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
  giveUpTimer: ReturnType<typeof setTimeout> | null;
  statsTimer: ReturnType<typeof setInterval> | null;
  lastStats: { packetsLost: number; packetsReceived: number } | null;
  stopRouteWatch: (() => void) | null;
}

const RESTART_AFTER_MS = 2500;
const GIVE_UP_AFTER_MS = 25_000;
const STATS_EVERY_MS = 2000;

let session: Session | null = null;
let incomingOffer: RtcSessionDescription | null = null;

function clearTimers(s: Session) {
  if (s.restartTimer) clearTimeout(s.restartTimer);
  if (s.giveUpTimer) clearTimeout(s.giveUpTimer);
  if (s.statsTimer) clearInterval(s.statsTimer);
  s.restartTimer = null;
  s.giveUpTimer = null;
  s.statsTimer = null;
}

function teardown() {
  if (session) {
    clearTimers(session);
    session.stopRouteWatch?.();
    try {
      session.pc.onicecandidate = null;
      session.pc.onconnectionstatechange = null;
      session.pc.oniceconnectionstatechange = null;
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
  getAudioRoute().stop();
}

/** Mute/unmute what we send and what we hear, used by both mute and hold. */
function applyAudio(muted: boolean, onHold: boolean, peerOnHold: boolean) {
  if (!session) return;
  for (const t of session.local.getAudioTracks()) t.enabled = !muted && !onHold;
  if (session.remote) for (const t of session.remote.getAudioTracks()) t.enabled = !onHold && !peerOnHold;
}

/** TURN and STUN from the server (credentials stay there); public STUN if the API is unreachable. */
async function fetchIceServers(): Promise<IceServer[]> {
  try {
    const res = await Promise.race([api<IceServersResponse>("/v1/calls/ice"), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000))]);
    return res.iceServers.length > 0 ? res.iceServers : iceServers();
  } catch {
    return iceServers();
  }
}

const tuned = (d: RtcSessionDescription): RtcSessionDescription => ({ type: d.type, sdp: tuneOpus(d.sdp) });

export const useCall = create<CallState>((set, get) => {
  function finish(reason: string) {
    teardown();
    set({ phase: "ended", endReason: reason, connectedAt: null, muted: false, onHold: false, peerOnHold: false, quality: null, reconnecting: false });
  }

  async function flushRemoteIce() {
    if (!session) return;
    const queued = session.pendingRemoteIce.splice(0);
    for (const c of queued) await session.pc.addIceCandidate(c).catch(() => undefined);
  }

  /** Caller side: renegotiate with fresh ICE credentials after the transport dropped. */
  async function restartIce() {
    const s = session;
    const { callId } = get();
    if (!s || !callId || !s.isCaller) return;
    try {
      set({ reconnecting: true });
      if (s.pc.restartIce) s.pc.restartIce();
      const offer = await s.pc.createOffer({ offerToReceiveAudio: true, iceRestart: true });
      const local = tuned(offer);
      await s.pc.setLocalDescription(local);
      sendSocketEvent({ type: "call.sdp", callId, sdp: { type: local.type, sdp: local.sdp } });
    } catch {
      // the give-up timer ends the call if this never recovers
    }
  }

  function watchQuality(s: Session) {
    if (s.statsTimer) clearInterval(s.statsTimer);
    s.statsTimer = setInterval(async () => {
      try {
        const report = await s.pc.getStats();
        let rtt: number | null = null;
        let lost = 0;
        let received = 0;
        let jitter = 0;
        const rows = report instanceof Map ? [...report.values()] : [...report];
        for (const r of rows) {
          if (r.type === "candidate-pair" && (r.state === "succeeded" || r.nominated === true) && typeof r.currentRoundTripTime === "number") rtt = r.currentRoundTripTime;
          if (r.type === "inbound-rtp" && (r.kind === "audio" || r.mediaType === "audio")) {
            lost = Number(r.packetsLost ?? 0);
            received = Number(r.packetsReceived ?? 0);
            jitter = Number(r.jitter ?? 0);
          }
        }
        const prev = s.lastStats;
        s.lastStats = { packetsLost: lost, packetsReceived: received };
        let lossPct = 0;
        if (prev) {
          const dLost = lost - prev.packetsLost;
          const dRecv = received - prev.packetsReceived;
          const total = dLost + dRecv;
          lossPct = total > 0 ? (dLost / total) * 100 : 0;
        }
        const quality: CallQuality = lossPct > 8 || (rtt !== null && rtt > 0.5) || jitter > 0.08 ? "poor" : lossPct > 2 || (rtt !== null && rtt > 0.25) || jitter > 0.03 ? "fair" : "good";
        if (get().phase === "active" && get().quality !== quality) set({ quality });
      } catch {
        // stats unavailable on this platform
      }
    }, STATS_EVERY_MS);
  }

  function newSession(local: RtcStream, servers: IceServer[], isCaller: boolean): Session {
    const rtc = getRtc()!;
    const pc = rtc.createPeerConnection({ iceServers: servers });
    const s: Session = { pc, local, remote: null, stopRemote: null, pendingLocalIce: [], pendingRemoteIce: [], isCaller, restartTimer: null, giveUpTimer: null, statsTimer: null, lastStats: null, stopRouteWatch: null };
    for (const track of local.getTracks()) pc.addTrack(track, local);
    void prioritiseAudio(pc);
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const { callId } = get();
      if (callId) sendSocketEvent({ type: "call.ice", callId, candidate: toIce(candidate) });
      else s.pendingLocalIce.push(candidate);
    };
    pc.ontrack = ({ streams }) => {
      if (streams[0] && !s.stopRemote) {
        s.remote = streams[0];
        s.stopRemote = rtc.playRemote(streams[0]);
        const { muted, onHold, peerOnHold } = get();
        applyAudio(muted, onHold, peerOnHold);
      }
    };
    const onState = () => {
      const state = pc.connectionState === "new" || !pc.connectionState ? pc.iceConnectionState : pc.connectionState;
      if (state === "connected" || state === "completed") {
        if (s.restartTimer) clearTimeout(s.restartTimer);
        if (s.giveUpTimer) clearTimeout(s.giveUpTimer);
        s.restartTimer = null;
        s.giveUpTimer = null;
        if (get().phase !== "active") set({ phase: "active", connectedAt: get().connectedAt ?? Date.now(), reconnecting: false });
        else if (get().reconnecting) set({ reconnecting: false });
        return;
      }
      if (state === "disconnected" || state === "failed") {
        if (!s.restartTimer) s.restartTimer = setTimeout(() => void restartIce(), state === "failed" ? 0 : RESTART_AFTER_MS);
        if (!s.giveUpTimer) {
          s.giveUpTimer = setTimeout(() => {
            const { callId } = get();
            if (callId) sendSocketEvent({ type: "call.end", callId, reason: "failed" });
            finish("failed");
          }, GIVE_UP_AFTER_MS);
        }
        set({ reconnecting: true });
      }
    };
    pc.onconnectionstatechange = onState;
    pc.oniceconnectionstatechange = onState;
    const route = getAudioRoute();
    route.start();
    void route.list().then((st) => set({ availableRoutes: st.available, audioRoute: st.selected ?? get().audioRoute }));
    s.stopRouteWatch = route.onChange((st) => set({ availableRoutes: st.available, audioRoute: st.selected ?? get().audioRoute }));
    watchQuality(s);
    return s;
  }

  return {
    phase: "idle",
    callId: null,
    conversationId: null,
    peer: null,
    connectedAt: null,
    muted: false,
    onHold: false,
    peerOnHold: false,
    audioRoute: "earpiece",
    availableRoutes: ["earpiece", "speaker"],
    quality: null,
    reconnecting: false,
    endReason: null,
    error: null,

    async startCall(conversationId, peer) {
      const rtc = getRtc();
      if (!rtc) {
        set({ error: "Voice calls need the installed app or the web version. They are not available inside Expo Go." });
        return;
      }
      if (get().phase !== "idle" && get().phase !== "ended") return;
      set({ phase: "outgoing", conversationId, peer, callId: null, endReason: null, error: null, muted: false, onHold: false, peerOnHold: false, quality: null, reconnecting: false, connectedAt: null, audioRoute: "earpiece" });
      try {
        const [local, servers] = await Promise.all([rtc.getAudioStream(), fetchIceServers()]);
        session = newSession(local, servers, true);
        const offer = tuned(await session.pc.createOffer({ offerToReceiveAudio: true }));
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
        const [local, servers] = await Promise.all([rtc.getAudioStream(), fetchIceServers()]);
        session = newSession(local, servers, false);
        set({ phase: "connecting", muted: false, onHold: false, peerOnHold: false });
        await session.pc.setRemoteDescription(tuned(incomingOffer));
        await flushRemoteIce();
        const answer = tuned(await session.pc.createAnswer());
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
      applyAudio(muted, get().onHold, get().peerOnHold);
      set({ muted });
    },

    toggleHold() {
      const { callId, onHold, muted, peerOnHold } = get();
      if (!session || !callId) return;
      const next = !onHold;
      applyAudio(muted, next, peerOnHold);
      sendSocketEvent({ type: "call.hold", callId, onHold: next });
      set({ onHold: next });
    },

    async chooseRoute(route) {
      await getAudioRoute().choose(route);
      set({ audioRoute: route });
    },

    async toggleSpeaker() {
      const next: AudioRouteName = get().audioRoute === "speaker" ? "earpiece" : "speaker";
      await get().chooseRoute(next);
    },

    dismiss() {
      if (get().phase === "ended") set({ phase: "idle", callId: null, conversationId: null, peer: null, endReason: null, error: null, quality: null, reconnecting: false });
      else set({ error: null });
    },

    onSocketReady() {
      const s = session;
      if (!s || !s.isCaller || !get().callId) return;
      const state = s.pc.connectionState === "new" || !s.pc.connectionState ? s.pc.iceConnectionState : s.pc.connectionState;
      if (state !== "connected" && state !== "completed") void restartIce();
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
          set({ phase: "incoming", callId: event.callId, conversationId: event.conversationId, peer: event.from, endReason: null, error: null, connectedAt: null, onHold: false, peerOnHold: false, quality: null, reconnecting: false, audioRoute: "earpiece" });
          return;
        }
        case "call.answered": {
          if (event.callId !== get().callId || !session) return;
          set({ phase: "connecting" });
          void session.pc
            .setRemoteDescription(tuned(event.sdp))
            .then(flushRemoteIce)
            .catch(() => {
              sendSocketEvent({ type: "call.end", callId: event.callId, reason: "failed" });
              finish("failed");
            });
          return;
        }
        case "call.sdp": {
          const s = session;
          if (event.callId !== get().callId || !s) return;
          if (event.sdp.type === "offer") {
            // Callee side of an ICE restart: answer it.
            void (async () => {
              try {
                await s.pc.setRemoteDescription(tuned(event.sdp));
                await flushRemoteIce();
                const answer = tuned(await s.pc.createAnswer());
                await s.pc.setLocalDescription(answer);
                sendSocketEvent({ type: "call.sdp", callId: event.callId, sdp: { type: answer.type, sdp: answer.sdp } });
              } catch {
                // give-up timer handles a dead transport
              }
            })();
          } else {
            void s.pc.setRemoteDescription(tuned(event.sdp)).then(flushRemoteIce).catch(() => undefined);
          }
          return;
        }
        case "call.ice": {
          if (event.callId !== get().callId) return;
          if (!session) return;
          if (session.pc.remoteDescription) void session.pc.addIceCandidate(event.candidate).catch(() => undefined);
          else session.pendingRemoteIce.push(event.candidate);
          return;
        }
        case "call.hold": {
          if (event.callId !== get().callId) return;
          applyAudio(get().muted, get().onHold, event.onHold);
          set({ peerOnHold: event.onHold });
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
