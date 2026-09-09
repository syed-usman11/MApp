import { NativeEventEmitter, NativeModules, Platform } from "react-native";

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
  kind?: string;
  stop(): void;
}

export interface RtcStream {
  getTracks(): RtcTrack[];
  getAudioTracks(): RtcTrack[];
}

export interface RtcSender {
  track?: RtcTrack | null;
  getParameters(): { encodings?: Array<Record<string, unknown>>; [k: string]: unknown };
  setParameters(p: unknown): Promise<void>;
}

export interface RtcPeerConnection {
  addTrack(track: RtcTrack, stream: RtcStream): RtcSender;
  getSenders(): RtcSender[];
  createOffer(options?: { offerToReceiveAudio?: boolean; iceRestart?: boolean }): Promise<RtcSessionDescription>;
  createAnswer(): Promise<RtcSessionDescription>;
  setLocalDescription(desc: RtcSessionDescription): Promise<void>;
  setRemoteDescription(desc: RtcSessionDescription): Promise<void>;
  addIceCandidate(candidate: RtcIceCandidate): Promise<void>;
  restartIce?: () => void;
  getStats(): Promise<Iterable<Record<string, unknown>> | Map<string, Record<string, unknown>>>;
  close(): void;
  connectionState: string;
  iceConnectionState: string;
  signalingState: string;
  remoteDescription: unknown;
  onicecandidate: ((ev: { candidate: RtcIceCandidate | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  ontrack: ((ev: { streams: RtcStream[] }) => void) | null;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RtcApi {
  createPeerConnection(config: { iceServers: IceServer[] }): RtcPeerConnection;
  /** Microphone with echo cancellation, noise suppression and automatic gain. */
  getAudioStream(): Promise<RtcStream>;
  /** Route a remote stream to the speaker/earpiece. Web needs an <audio> element; native plays automatically. */
  playRemote(stream: RtcStream): () => void;
}

/** Audio processing asked of the microphone. Native builds also honour the Google-prefixed names. */
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
  googEchoCancellation: true,
  googNoiseSuppression: true,
  googAutoGainControl: true,
  googHighpassFilter: true,
  googTypingNoiseDetection: true,
};

/** Peer-connection options that favour a fast, resilient audio-only call. */
const PC_OPTIONS = { bundlePolicy: "max-bundle", rtcpMuxPolicy: "require", iceCandidatePoolSize: 2 };

let cached: RtcApi | null | undefined;
let remoteAudioElement: HTMLAudioElement | null = null;

export function getRtc(): RtcApi | null {
  if (cached !== undefined) return cached;
  cached = Platform.OS === "web" ? webRtc() : nativeRtc();
  return cached;
}

function webRtc(): RtcApi | null {
  const w = globalThis as unknown as { RTCPeerConnection?: new (c: unknown) => RtcPeerConnection; navigator?: Navigator; document?: Document };
  if (!w.RTCPeerConnection || !w.navigator?.mediaDevices) return null;
  return {
    createPeerConnection: (config) => new w.RTCPeerConnection!({ ...config, ...PC_OPTIONS }),
    getAudioStream: async () => (await w.navigator!.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS as MediaTrackConstraints, video: false })) as unknown as RtcStream,
    playRemote: (stream) => {
      const audio = w.document!.createElement("audio");
      audio.autoplay = true;
      (audio as unknown as { srcObject: unknown }).srcObject = stream;
      w.document!.body.appendChild(audio);
      remoteAudioElement = audio;
      return () => {
        audio.pause();
        audio.remove();
        if (remoteAudioElement === audio) remoteAudioElement = null;
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
      createPeerConnection: (config) => new mod.RTCPeerConnection({ ...config, ...PC_OPTIONS }),
      getAudioStream: () => mod.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false }),
      playRemote: () => () => undefined,
    };
  } catch {
    return null;
  }
}

/** Fallback ICE servers when the API cannot be reached: public STUN only. */
export function iceServers(): IceServer[] {
  const servers: IceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
  const turn = process.env.EXPO_PUBLIC_TURN_URL;
  if (turn) {
    servers.push({ urls: turn.split(",").map((u: string) => u.trim()), username: process.env.EXPO_PUBLIC_TURN_USERNAME, credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL });
  }
  return servers;
}

/**
 * Tune the Opus audio line in an SDP for speech over lossy networks: in-band
 * forward error correction, a comfortable 48 kbps average, mono, and short
 * packets. Applied to both local and remote descriptions.
 */
export function tuneOpus(sdp: string): string {
  const match = sdp.match(/a=rtpmap:(\d+) opus\/48000(?:\/2)?/i);
  if (!match) return sdp;
  const pt = match[1];
  const params = "minptime=10;useinbandfec=1;usedtx=0;stereo=0;sprop-stereo=0;maxaveragebitrate=48000;maxplaybackrate=48000;cbr=0";
  const fmtp = new RegExp(`a=fmtp:${pt} .*`, "i");
  if (fmtp.test(sdp)) return sdp.replace(fmtp, `a=fmtp:${pt} ${params}`);
  return sdp.replace(`a=rtpmap:${pt} ${match[0].split(" ")[1]}`, `$&\r\na=fmtp:${pt} ${params}`);
}

/** Ask the sender to prioritise the audio track and cap its bitrate sensibly. */
export async function prioritiseAudio(pc: RtcPeerConnection): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind && sender.track.kind !== "audio") continue;
    try {
      const params = sender.getParameters();
      const encodings = params.encodings && params.encodings.length > 0 ? params.encodings : [{}];
      encodings[0] = { ...encodings[0], maxBitrate: 64000, priority: "high", networkPriority: "high" };
      await sender.setParameters({ ...params, encodings });
    } catch {
      // Some platforms reject priority fields; the defaults are fine.
    }
  }
}

// ---------------------------------------------------------------------------
// Audio routing: earpiece / speaker / Bluetooth / wired headset
// ---------------------------------------------------------------------------

export type AudioRouteName = "earpiece" | "speaker" | "bluetooth" | "wired";

export interface AudioRouteState {
  available: AudioRouteName[];
  selected: AudioRouteName | null;
}

export interface AudioRoute {
  available: boolean;
  /** Put the OS into "in call" audio mode: proximity sensor, hardware echo cancellation, routing rules. */
  start(): void;
  stop(): void;
  choose(route: AudioRouteName): Promise<void>;
  /** Routes present right now, e.g. no "bluetooth" until a headset connects. */
  list(): Promise<AudioRouteState>;
  /** Fires when a headset connects or the OS moves the route. */
  onChange(cb: (state: AudioRouteState) => void): () => void;
}

const NATIVE_ROUTE: Record<AudioRouteName, string> = { earpiece: "EARPIECE", speaker: "SPEAKER_PHONE", bluetooth: "BLUETOOTH", wired: "WIRED_HEADSET" };
const FROM_NATIVE: Record<string, AudioRouteName> = { EARPIECE: "earpiece", SPEAKER_PHONE: "speaker", BLUETOOTH: "bluetooth", WIRED_HEADSET: "wired" };

let routeCached: AudioRoute | undefined;

export function getAudioRoute(): AudioRoute {
  if (routeCached) return routeCached;
  routeCached = Platform.OS === "web" ? webRoute() : nativeRoute();
  return routeCached;
}

interface InCallManagerLike {
  start(opts: { media: "audio" | "video" }): void;
  stop(): void;
  setForceSpeakerphoneOn(on: boolean): void;
  chooseAudioRoute(route: string): Promise<unknown>;
}

function nativeRoute(): AudioRoute {
  const noop: AudioRoute = {
    available: false,
    start: () => undefined,
    stop: () => undefined,
    choose: async () => undefined,
    list: async () => ({ available: ["speaker"], selected: "speaker" }),
    onChange: () => () => undefined,
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-incall-manager") as { default?: InCallManagerLike } & InCallManagerLike;
    const icm = mod.default ?? mod;
    if (!icm?.start) return noop;
    let last: AudioRouteState = { available: ["earpiece", "speaker"], selected: "earpiece" };
    const listeners = new Set<(s: AudioRouteState) => void>();
    const native = NativeModules.InCallManager;
    if (native) {
      const emitter = new NativeEventEmitter(native);
      emitter.addListener("onAudioDeviceChanged", (event: { availableAudioDeviceList?: string | string[]; selectedAudioDevice?: string }) => {
        try {
          const raw = event.availableAudioDeviceList;
          const names: string[] = typeof raw === "string" ? (JSON.parse(raw) as string[]) : Array.isArray(raw) ? raw : [];
          const available = names.map((n) => FROM_NATIVE[n]).filter((r): r is AudioRouteName => !!r);
          const selected = event.selectedAudioDevice ? (FROM_NATIVE[event.selectedAudioDevice] ?? null) : last.selected;
          last = { available: available.length > 0 ? available : last.available, selected };
          for (const l of listeners) l(last);
        } catch {
          // malformed payload; keep the previous state
        }
      });
    }
    return {
      available: true,
      start: () => {
        try {
          icm.start({ media: "audio" });
          icm.setForceSpeakerphoneOn(false);
        } catch {
          // audio session already active
        }
      },
      stop: () => {
        try {
          icm.setForceSpeakerphoneOn(false);
          icm.stop();
        } catch {
          // already stopped
        }
      },
      choose: async (route) => {
        try {
          if (route === "speaker") icm.setForceSpeakerphoneOn(true);
          else {
            icm.setForceSpeakerphoneOn(false);
            await icm.chooseAudioRoute(NATIVE_ROUTE[route]);
          }
          last = { ...last, selected: route };
          for (const l of listeners) l(last);
        } catch {
          // route not available right now
        }
      },
      list: async () => last,
      onChange: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
  } catch {
    return noop;
  }
}

function webRoute(): AudioRoute {
  const nav = (globalThis as unknown as { navigator?: Navigator }).navigator;
  const devices = async () => {
    if (!nav?.mediaDevices?.enumerateDevices) return [] as MediaDeviceInfo[];
    return (await nav.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
  };
  const classify = (label: string): AudioRouteName | null => {
    const l = label.toLowerCase();
    if (/bluetooth|airpod|buds|bt\b|wireless/.test(l)) return "bluetooth";
    if (/headphone|headset|wired|jack|earphone/.test(l)) return "wired";
    return null;
  };
  const listState = async (): Promise<AudioRouteState> => {
    const outs = await devices();
    const available: AudioRouteName[] = ["speaker"];
    for (const d of outs) {
      const r = classify(d.label);
      if (r && !available.includes(r)) available.push(r);
    }
    const currentSink = (remoteAudioElement as unknown as { sinkId?: string } | null)?.sinkId ?? "";
    const current = outs.find((d) => d.deviceId === currentSink);
    return { available, selected: current ? (classify(current.label) ?? "speaker") : "speaker" };
  };
  const listeners = new Set<(s: AudioRouteState) => void>();
  nav?.mediaDevices?.addEventListener?.("devicechange", () => {
    void listState().then((s) => {
      for (const l of listeners) l(s);
    });
  });
  return {
    available: !!nav?.mediaDevices?.enumerateDevices,
    start: () => undefined,
    stop: () => undefined,
    choose: async (route) => {
      const el = remoteAudioElement as unknown as { setSinkId?: (id: string) => Promise<void> } | null;
      if (!el?.setSinkId) return;
      const outs = await devices();
      const target = route === "speaker" ? outs.find((d) => d.deviceId === "default") ?? outs[0] : outs.find((d) => classify(d.label) === route);
      if (target) await el.setSinkId(target.deviceId).catch(() => undefined);
    },
    list: listState,
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
