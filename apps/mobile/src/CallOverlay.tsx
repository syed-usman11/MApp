import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { describeEnd, useCall } from "./callStore";
import { formatDuration } from "./media";
import { fonts, spacing } from "./theme";
import { Avatar, PressableScale } from "./ui";
import { useStyles, useTheme, type Theme } from "./useTheme";

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
  const connectedAt = useCall((c) => c.connectedAt);
  const endReason = useCall((c) => c.endReason);
  const error = useCall((c) => c.error);
  const accept = useCall((c) => c.accept);
  const decline = useCall((c) => c.decline);
  const hangup = useCall((c) => c.hangup);
  const toggleMute = useCall((c) => c.toggleMute);
  const dismiss = useCall((c) => c.dismiss);
  const [now, setNow] = useState(Date.now());

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

  const status =
    error ??
    (phase === "outgoing" ? "Calling…" : phase === "incoming" ? "Incoming voice call" : phase === "connecting" ? "Connecting…" : phase === "active" && connectedAt ? formatDuration(now - connectedAt) : describeEnd(endReason));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => (phase === "incoming" ? decline() : phase === "ended" || error ? dismiss() : hangup())}>
      <View style={[s.screen, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <Animated.View entering={FadeIn} style={s.top}>
          <Text style={s.kicker}>{phase === "incoming" ? "MApp voice" : "Voice call"}</Text>
          <Animated.View entering={ZoomIn.springify().damping(24).stiffness(140)}>
            <Avatar name={peer?.displayName ?? "?"} size={112} />
          </Animated.View>
          <Text style={s.name}>{peer?.displayName ?? "Unknown"}</Text>
          <Text style={[s.status, (phase === "ended" || error) && { color: colors.danger }]}>{status}</Text>
        </Animated.View>

        <View style={s.controls}>
          {phase === "incoming" ? (
            <>
              <RoundButton icon="close" label="Decline" color={colors.danger} onPress={decline} />
              <RoundButton icon="call" label="Answer" color={colors.online} onPress={() => void accept()} />
            </>
          ) : phase === "ended" || error ? (
            <RoundButton icon="close" label="Close" color={colors.muted} onPress={dismiss} />
          ) : (
            <>
              <RoundButton icon={muted ? "mic-off" : "mic"} label={muted ? "Unmute" : "Mute"} color={muted ? colors.text : colors.muted} onPress={toggleMute} />
              <RoundButton icon="call" label="End" color={colors.danger} onPress={hangup} rotate />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function RoundButton({ icon, label, color, onPress, rotate }: { icon: "call" | "close" | "mic" | "mic-off"; label: string; color: string; onPress: () => void; rotate?: boolean }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.control}>
      <PressableScale onPress={onPress} scaleTo={0.88} style={[s.round, { backgroundColor: color }]} accessibilityLabel={label}>
        <Ionicons name={icon} size={30} color="#fff" style={rotate ? { transform: [{ rotate: "135deg" }] } : undefined} />
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
    controls: { flexDirection: "row", gap: spacing.xxl, alignItems: "flex-start" },
    control: { alignItems: "center", gap: spacing.sm },
    round: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
    controlLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted },
  });
