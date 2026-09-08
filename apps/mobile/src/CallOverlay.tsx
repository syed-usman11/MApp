import { Ionicons } from "@expo/vector-icons";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useEffect, useState } from "react";
import { Modal, Platform, StyleSheet, Text, Vibration, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { describeEnd, useCall } from "./callStore";
import { formatDuration } from "./media";
import { fonts, spacing } from "./theme";
import { Avatar, PressableScale, type IconName } from "./ui";
import { useStyles, useTheme, type Theme } from "./useTheme";
import { getAudioRoute } from "./webrtc";

/**
 * Full-screen voice call UI, mounted once in the root layout so an incoming
 * call shows over whatever screen is open. Idle renders nothing.
 */
export function CallOverlay() {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const phase = useCall((c) => c.phase);
  const peer = useCall((c) => c.peer);
  const muted = useCall((c) => c.muted);
  const speakerOn = useCall((c) => c.speakerOn);
  const onHold = useCall((c) => c.onHold);
  const peerOnHold = useCall((c) => c.peerOnHold);
  const connectedAt = useCall((c) => c.connectedAt);
  const endReason = useCall((c) => c.endReason);
  const error = useCall((c) => c.error);
  const accept = useCall((c) => c.accept);
  const decline = useCall((c) => c.decline);
  const hangup = useCall((c) => c.hangup);
  const toggleMute = useCall((c) => c.toggleMute);
  const toggleSpeaker = useCall((c) => c.toggleSpeaker);
  const toggleHold = useCall((c) => c.toggleHold);
  const dismiss = useCall((c) => c.dismiss);
  const [now, setNow] = useState(Date.now());
  const ringback = useAudioPlayer(require("../assets/sounds/ringback.wav"));
  const ringtone = useAudioPlayer(require("../assets/sounds/ringtone.wav"));
  const speakerAvailable = getAudioRoute().available;

  // Ringback while we wait for the other side; ringtone and vibration while they wait for us.
  useEffect(() => {
    const start = (player: typeof ringback) => {
      player.loop = true;
      void player.seekTo(0);
      player.play();
    };
    const stop = (player: typeof ringback) => {
      try {
        player.pause();
      } catch {
        // player may already be released
      }
    };
    if (phase === "outgoing") {
      void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
      start(ringback);
      stop(ringtone);
    } else if (phase === "incoming") {
      void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
      start(ringtone);
      stop(ringback);
      if (Platform.OS !== "web") Vibration.vibrate([0, 600, 400, 600, 400], true);
    } else {
      stop(ringback);
      stop(ringtone);
      if (Platform.OS !== "web") Vibration.cancel();
    }
    return () => {
      if (Platform.OS !== "web") Vibration.cancel();
    };
  }, [phase, ringback, ringtone]);

  useEffect(() => {
    if (phase !== "active") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "ended") return;
    const t = setTimeout(dismiss, 1800);
    return () => clearTimeout(t);
  }, [phase, dismiss]);

  const visible = phase !== "idle" || !!error;
  if (!visible) return null;

  const inCall = phase === "connecting" || phase === "active";
  const status =
    error ??
    (phase === "outgoing"
      ? "Calling…"
      : phase === "incoming"
        ? "Incoming voice call"
        : phase === "connecting"
          ? "Connecting…"
          : phase === "active"
            ? onHold
              ? "On hold"
              : peerOnHold
                ? `${peer?.displayName?.split(" ")[0] ?? "They"} put you on hold`
                : connectedAt
                  ? formatDuration(now - connectedAt)
                  : "Connected"
            : describeEnd(endReason));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => (phase === "incoming" ? decline() : phase === "ended" || error ? dismiss() : hangup())}>
      <View style={[s.screen, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <Animated.View entering={FadeIn} style={s.top}>
          <Text style={s.kicker}>{phase === "incoming" ? "MApp voice" : "Voice call"}</Text>
          <Animated.View entering={ZoomIn.springify().damping(24).stiffness(140)}>
            <Avatar name={peer?.displayName ?? "?"} size={112} uri={peer?.avatarUrl} />
          </Animated.View>
          <Text style={s.name}>{peer?.displayName ?? "Unknown"}</Text>
          <Text style={[s.status, (phase === "ended" || error) && { color: colors.danger }, (onHold || peerOnHold) && phase === "active" && { color: colors.primary }]}>{status}</Text>
        </Animated.View>

        {inCall ? (
          <View style={s.grid}>
            <RoundButton icon={muted ? "mic-off" : "mic"} label={muted ? "Unmute" : "Mute"} active={muted} onPress={toggleMute} small />
            <RoundButton icon={speakerOn ? "volume-high" : "volume-medium-outline"} label="Speaker" active={speakerOn} onPress={toggleSpeaker} small disabled={!speakerAvailable} />
            <RoundButton icon={onHold ? "play" : "pause"} label={onHold ? "Resume" : "Hold"} active={onHold} onPress={toggleHold} small />
          </View>
        ) : null}

        <View style={s.controls}>
          {phase === "incoming" ? (
            <>
              <RoundButton icon="close" label="Decline" color={colors.danger} onPress={decline} />
              <RoundButton icon="call" label="Answer" color={colors.online} onPress={() => void accept()} />
            </>
          ) : phase === "ended" || error ? (
            <RoundButton icon="close" label="Close" color={colors.muted} onPress={dismiss} />
          ) : (
            <RoundButton icon="call" label="End" color={colors.danger} onPress={hangup} rotate />
          )}
        </View>
      </View>
    </Modal>
  );
}

function RoundButton({
  icon,
  label,
  color,
  active,
  onPress,
  rotate,
  small,
  disabled,
}: {
  icon: IconName;
  label: string;
  color?: string;
  active?: boolean;
  onPress: () => void;
  rotate?: boolean;
  small?: boolean;
  disabled?: boolean;
}) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const bg = color ?? (active ? colors.primary : colors.cardAlt);
  const fg = color ? "#fff" : active ? colors.onPrimary : colors.text;
  return (
    <View style={s.control}>
      <PressableScale onPress={onPress} scaleTo={0.88} disabled={disabled} style={[small ? s.roundSmall : s.round, { backgroundColor: bg }, disabled && s.disabled]} accessibilityLabel={label} accessibilityState={{ selected: !!active }}>
        <Ionicons name={icon} size={small ? 24 : 30} color={fg} style={rotate ? { transform: [{ rotate: "135deg" }] } : undefined} />
      </PressableScale>
      <Text style={s.controlLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl },
    top: { alignItems: "center", gap: spacing.lg, marginTop: spacing.xxl },
    kicker: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, textTransform: "uppercase", letterSpacing: 1 },
    name: { fontFamily: fonts.extrabold, fontSize: 30, color: colors.text, letterSpacing: -0.5 },
    status: { fontFamily: fonts.medium, fontSize: 16, color: colors.muted },
    grid: { flexDirection: "row", gap: spacing.xl, alignItems: "flex-start" },
    controls: { flexDirection: "row", gap: spacing.xxl, alignItems: "flex-start" },
    control: { alignItems: "center", gap: spacing.sm },
    round: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
    roundSmall: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
    disabled: { opacity: 0.35 },
    controlLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted },
  });
