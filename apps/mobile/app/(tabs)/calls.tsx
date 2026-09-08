import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import type { CallRecord, ListCallsResponse } from "@mapp/protocol";
import { api, errorMessage } from "../../src/api";
import { useCall } from "../../src/callStore";
import { useChat } from "../../src/chatStore";
import { useTabBarSpace } from "../../src/GlassTabBar";
import { formatDuration } from "../../src/media";
import { useSession } from "../../src/session";
import { fonts, radius, spacing } from "../../src/theme";
import { TopBar, useTopBarSpace } from "../../src/TopBar";
import { Avatar, ErrorText, IconButton, InfoText, Muted, PressableScale } from "../../src/ui";
import { useStyles, useTheme, type Theme } from "../../src/useTheme";
import { getRtc } from "../../src/webrtc";

export default function Calls() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const me = useSession((st) => st.user);
  const presence = useChat((st) => st.presence);
  const openDirect = useChat((st) => st.openDirect);
  const startCall = useCall((c) => c.startCall);
  const phase = useCall((c) => c.phase);
  const topSpace = useTopBarSpace();
  const bottomSpace = useTabBarSpace();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const supported = useMemo(() => !!getRtc(), []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api<ListCallsResponse>("/v1/calls");
      setCalls(res.calls);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reload the log when a call finishes.
  useEffect(() => {
    if (phase === "ended") void refresh();
  }, [phase, refresh]);

  async function callBack(record: CallRecord) {
    if (!record.peer.username) return;
    setBusy(record.id);
    try {
      const conv = await openDirect(record.peer.username);
      await startCall(conv.id, record.peer);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={s.screen}>
      <TopBar title="Calls" right={<IconButton icon="add-circle-outline" size={28} onPress={() => router.push("/new-chat")} label="New call" />} />
      <FlatList
        data={calls}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} progressViewOffset={topSpace} />}
        contentContainerStyle={[s.list, { paddingTop: topSpace + spacing.md, paddingBottom: bottomSpace }]}
        ListHeaderComponent={
          <Animated.View entering={FadeInDown.springify().damping(24).stiffness(140)} style={s.header}>
            {!supported ? <InfoText icon="phone-portrait-outline">Voice calls work in the installed app and on the web. They are not available inside Expo Go.</InfoText> : null}
            <ErrorText>{error}</ErrorText>
          </Animated.View>
        }
        ListEmptyComponent={
          <Animated.View entering={ZoomIn.delay(120).springify().damping(24).stiffness(140)} style={s.empty}>
            <Ionicons name="call-outline" size={44} color={colors.border} />
            <Muted>No calls yet. Open a chat and tap the phone icon.</Muted>
          </Animated.View>
        }
        renderItem={({ item, index }) => {
          const outgoing = item.callerId === me?.id;
          const missed = item.status === "missed" || (item.status === "declined" && !outgoing);
          const duration = item.answeredAt && item.endedAt ? formatDuration(new Date(item.endedAt).getTime() - new Date(item.answeredAt).getTime()) : null;
          const detail = item.status === "ringing" ? "Ringing" : item.status === "answered" ? "In progress" : missed ? (outgoing ? "No answer" : "Missed") : item.status === "declined" ? "Declined" : item.status === "failed" ? "Failed" : (duration ?? "Ended");
          return (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(24).stiffness(140)}>
              <View style={s.row}>
                <Avatar name={item.peer.displayName} size={48} online={presence[item.peer.id]} uri={item.peer.avatarUrl} />
                <View style={s.flex}>
                  <Text style={[s.name, missed && { color: colors.danger }]} numberOfLines={1}>
                    {item.peer.displayName}
                  </Text>
                  <View style={s.detailRow}>
                    <Ionicons name={outgoing ? "arrow-up-outline" : "arrow-down-outline"} size={13} color={missed ? colors.danger : colors.muted} />
                    <Text style={s.detail}>
                      {detail} · {formatWhen(item.startedAt)}
                    </Text>
                  </View>
                </View>
                <IconButton icon="call" size={22} onPress={() => void callBack(item)} label={`Call ${item.peer.displayName}`} color={busy === item.id ? colors.muted : colors.primary} />
              </View>
            </Animated.View>
          );
        }}
      />
      <PressableScale onPress={() => router.push("/new-chat")} scaleTo={0.9} style={[s.fab, { bottom: bottomSpace }]} accessibilityLabel="Start a call">
        <Ionicons name="call" size={24} color={colors.onPrimary} />
      </PressableScale>
    </View>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: colors.bg },
    list: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    header: { gap: spacing.sm, marginBottom: spacing.xs },
    empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.md + 2, borderWidth: 1, borderColor: colors.border },
    name: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
    detailRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
    detail: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    fab: { position: "absolute", right: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", boxShadow: "0px 8px 24px rgba(11,110,79,0.35)" },
  });
