import { Platform } from "react-native";

/**
 * Minimal WebRTC surface the call store needs, resolved per platform:
 * - web: the browser's own RTCPeerConnection and getUserMedia
 * - iOS/Android release or development builds: react-native-webrtc
 * - Expo Go: unavailable, since the native module isn't bundled there
 *
 * Loaded lazily so importing this file never throws.
 */

export interface RtcSessionDescription {
  type: string;
  sdp: string;
}

export interface RtcIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

export interface RtcTrack {
  enabled: boolean;
  stop(): void;
}

export interface RtcStream {
  getTracks(): RtcTrack[];
  getAudioTracks(): RtcTrack[];
}

export interface RtcPeerConnection {
  addTrack(track: RtcTrack, stream: RtcStream): unknown;
  createOffer(options?: { offerToReceiveAudio?: boolean }): Promise<RtcSessionDescription>;
  createAnswer(): Promise<RtcSessionDescription>;
  setLocalDescription(desc: RtcSessionDescription): Promise<void>;
  setRemoteDescription(desc: RtcSessionDescription): Promise<void>;
  addIceCandidate(candidate: RtcIceCandidate): Promise<void>;
  close(): void;
  connectionState: string;
  remoteDescription: unknown;
  onicecandidate: ((ev: { candidate: RtcIceCandidate | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  ontrack: ((ev: { streams: RtcStream[] }) => void) | null;
}

export interface RtcApi {
  createPeerConnection(config: { iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> }): RtcPeerConnection;
  getAudioStream(): Promise<RtcStream>;
  /** Route a remote stream to the speaker/earpiece. Web needs an <audio> element; native plays automatically. */
  playRemote(stream: RtcStream): () => void;
}

let cached: RtcApi | null | undefined;

export function getRtc(): RtcApi | null {
  if (cached !== undefined) return cached;
  cached = Platform.OS === "web" ? webRtc() : nativeRtc();
  return cached;
}

function webRtc(): RtcApi | null {
  const w = globalThis as unknown as { RTCPeerConnection?: new (c: unknown) => RtcPeerConnection; navigator?: Navigator; document?: Document };
  if (!w.RTCPeerConnection || !w.navigator?.mediaDevices) return null;
  return {
    createPeerConnection: (config) => new w.RTCPeerConnection!(config),
    getAudioStream: async () => (await w.navigator!.mediaDevices.getUserMedia({ audio: true, video: false })) as unknown as RtcStream,
    playRemote: (stream) => {
      const audio = w.document!.createElement("audio");
      audio.autoplay = true;
      (audio as unknown as { srcObject: unknown }).srcObject = stream;
      w.document!.body.appendChild(audio);
      return () => {
        audio.pause();
        audio.remove();
      };
    },
  };
}

function nativeRtc(): RtcApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-webrtc") as {
      RTCPeerConnection: new (c: unknown) => RtcPeerConnection;
      mediaDevices: { getUserMedia(c: unknown): Promise<RtcStream> };
    };
    if (!mod?.RTCPeerConnection) return null;
    return {
      createPeerConnection: (config) => new mod.RTCPeerConnection(config),
      getAudioStream: () => mod.mediaDevices.getUserMedia({ audio: true, video: false }),
      playRemote: () => () => undefined,
    };
  } catch {
    return null;
  }
}

/** Google's public STUN plus an optional TURN relay from env, needed for phones behind carrier NAT. */
export function iceServers(): Array<{ urls: string | string[]; username?: string; credential?: string }> {
  const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const turn = process.env.EXPO_PUBLIC_TURN_URL;
  if (turn) {
    servers.push({ urls: turn.split(",").map((u: string) => u.trim()), username: process.env.EXPO_PUBLIC_TURN_USERNAME, credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL });
  }
  return servers;
}
