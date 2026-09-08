import { Ionicons } from "@expo/vector-icons";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { formatDuration, type LocalFile } from "./media";
import { fonts, radius, spacing } from "./theme";
import { PressableScale } from "./ui";
import { useStyles, useTheme, type Theme } from "./useTheme";

/** Inline player for an audio attachment. Fixed width so bubbles line up. */
export function VoiceNotePlayer({ url, durationMs, tint }: { url: string; durationMs?: number; tint: string }) {
  const s = useStyles(makeStyles);
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  const total = status.duration > 0 ? status.duration * 1000 : (durationMs ?? 0);
  const progress = total > 0 ? Math.min(1, (status.currentTime * 1000) / total) : 0;
  const finished = status.isLoaded && status.duration > 0 && status.currentTime >= status.duration - 0.05 && !status.playing;

  async function toggle() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (finished) await player.seekTo(0);
    player.play();
  }

  return (
    <View style={s.player}>
      <PressableScale onPress={() => void toggle()} scaleTo={0.85} style={[s.playButton, { backgroundColor: tint }]} accessibilityLabel={status.playing ? "Pause" : "Play"}>
        <Ionicons name={status.playing ? "pause" : "play"} size={18} color="#fff" style={status.playing ? undefined : { marginLeft: 2 }} />
      </PressableScale>
      <View style={s.trackWrap}>
        <View style={s.track}>
          <View style={[s.trackFill, { width: `${progress * 100}%`, backgroundColor: tint }]} />
        </View>
        <Text style={s.duration}>{formatDuration(status.playing || status.currentTime > 0 ? status.currentTime * 1000 : total)}</Text>
      </View>
    </View>
  );
}

/**
 * Hold-to-record microphone button. Calls `onRecorded` with the finished
 * file, or `onError` when the mic is unavailable (web without HTTPS, denied).
 */
export function RecordButton({ onRecorded, onError, disabled }: { onRecorded: (file: LocalFile) => void; onError: (message: string) => void; disabled?: boolean }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt.current), 200);
    return () => clearInterval(t);
  }, [recording]);

  async function start() {
    if (disabled || recording) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        onError("Microphone access was not allowed");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      cancelled.current = false;
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not start recording");
    }
  }

  async function stop(cancel: boolean) {
    if (!recording) return;
    setRecording(false);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const durationMs = Date.now() - startedAt.current;
      const uri = recorder.uri;
      if (cancel || cancelled.current || !uri || durationMs < 700) return;
      const ext = Platform.OS === "web" ? "webm" : "m4a";
      const mime = Platform.OS === "web" ? "audio/webm" : "audio/m4a";
      onRecorded({ uri, mime, name: `voice-${Date.now()}.${ext}`, durationMs });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Recording failed");
    }
  }

  return (
    <View style={s.recordWrap}>
      {recording ? (
        <View style={s.recordingPill}>
          <View style={s.recDot} />
          <Text style={s.recText}>{formatDuration(elapsed)}</Text>
          <Text style={s.recHint}>Release to send</Text>
        </View>
      ) : null}
      <Pressable
        onPressIn={() => void start()}
        onPressOut={() => void stop(false)}
        disabled={disabled}
        hitSlop={8}
        accessibilityLabel="Hold to record a voice message"
        style={[s.micButton, recording && { backgroundColor: colors.danger }, disabled && s.disabled]}
      >
        <Ionicons name="mic" size={22} color={recording ? "#fff" : colors.primary} />
      </Pressable>
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    player: { flexDirection: "row", alignItems: "center", gap: spacing.sm, width: 220, paddingVertical: 2 },
    playButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    trackWrap: { flex: 1, gap: 4 },
    track: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
    trackFill: { height: 4, borderRadius: 2 },
    duration: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted },
    recordWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    micButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
    disabled: { opacity: 0.4 },
    recordingPill: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill, backgroundColor: colors.dangerSoft },
    recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
    recText: { fontFamily: fonts.bold, color: colors.danger, fontSize: 13 },
    recHint: { fontFamily: fonts.regular, color: colors.muted, fontSize: 12 },
  });
