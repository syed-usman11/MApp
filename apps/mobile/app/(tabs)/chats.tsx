import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import type { Conversation } from "@mapp/protocol";
import { errorMessage } from "../../src/api";
import { useChat } from "../../src/chatStore";
import { useTabBarSpace } from "../../src/GlassTabBar";
import { useSession } from "../../src/session";
import { fonts, radius, spacing } from "../../src/theme";
import { TopBar, useTopBarSpace } from "../../src/TopBar";
import { Avatar, ErrorText, Field, IconButton, Muted, PressableScale } from "../../src/ui";
import { useStyles, useTheme, useThemeToggle, type Theme } from "../../src/useTheme";

export default function Chats() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const { isDark, toggle } = useThemeToggle();
  const me = useSession((st) => st.user);
  const conversations = useChat((st) => st.conversations);
  const presence = useChat((st) => st.presence);
  const connected = useChat((st) => st.connected);
  const loadConversations = useChat((st) => st.loadConversations);
  const topSpace = useTopBarSpace();
  const bottomSpace = useTabBarSpace();

  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadConversations();
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, [loadConversations]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(conversations)
      .filter((c) => {
        if (!q) return true;
        const peer = c.members.find((m) => m.id !== me?.id);
        return (peer?.displayName ?? "").toLowerCase().includes(q) || (peer?.username ?? "").toLowerCase().includes(q);
      })
      .sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
  }, [conversations, query, me?.id]);

  return (
    <View style={s.screen}>
      <TopBar
        title="Chats"
        left={
          <PressableScale onPress={() => router.navigate("/settings")} hitSlop={8} scaleTo={0.9} accessibilityLabel="Open settings">
            <Avatar name={me?.displayName ?? "?"} size={38} online={connected} />
          </PressableScale>
        }
        right={
          <>
            <IconButton icon={isDark ? "sunny-outline" : "moon-outline"} size={24} onPress={toggle} label="Toggle dark mode" />
            <IconButton icon="create-outline" size={26} onPress={() => router.push("/new-chat")} label="New chat" />
          </>
        }
      />
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} progressViewOffset={topSpace} />}
        contentContainerStyle={[s.list, { paddingTop: topSpace + spacing.md, paddingBottom: bottomSpace }]}
        ListHeaderComponent={
          <Animated.View entering={FadeInDown.springify().damping(18)} style={s.header}>
            <Field icon="search-outline" pill placeholder="Search chats" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} />
            <ErrorText>{error}</ErrorText>
          </Animated.View>
        }
        ListEmptyComponent={
          <Animated.View entering={ZoomIn.delay(120).springify().damping(16)} style={s.empty}>
            <Ionicons name="chatbubbles-outline" size={44} color={colors.border} />
            <Muted>{query ? "No chats match your search." : "No chats yet. Tap the compose icon to start one."}</Muted>
          </Animated.View>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(18)}>
            <ConversationRow conversation={item} meId={me?.id ?? ""} online={presence} onPress={() => router.push(`/chat/${item.id}`)} />
          </Animated.View>
        )}
      />
    </View>
  );
}

function ConversationRow({
  conversation,
  meId,
  online,
  onPress,
}: {
  conversation: Conversation;
  meId: string;
  online: Record<string, boolean>;
  onPress: () => void;
}) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const peer = conversation.members.find((m) => m.id !== meId) ?? conversation.members[0];
  const last = conversation.lastMessage;
  const preview = last ? `${last.senderId === meId ? "You: " : ""}${last.body}` : "Say hello";
  const time = last ? formatTime(last.createdAt) : "";
  const unread = conversation.unreadCount > 0;
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} style={s.row}>
      <Avatar name={peer?.displayName ?? "?"} size={50} online={peer ? online[peer.id] : false} />
      <View style={s.flex}>
        <View style={s.rowTop}>
          <View style={[s.nameRow, s.flex]}>
            <Text style={s.name} numberOfLines={1}>
              {peer?.displayName ?? "Unknown"}
            </Text>
            {peer?.verifiedCountry ? <Ionicons name="shield-checkmark" size={14} color={colors.primary} /> : null}
          </View>
          <Text style={[s.time, unread && s.timeUnread]}>{time}</Text>
        </View>
        <View style={s.rowBottom}>
          <Text style={[s.preview, unread && s.previewUnread]} numberOfLines={1}>
            {preview}
          </Text>
          {unread ? (
            <Animated.View entering={ZoomIn.springify()} style={s.badge}>
              <Text style={s.badgeText}>{conversation.unreadCount}</Text>
            </Animated.View>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

function formatTime(iso: string): string {
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
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      paddingVertical: spacing.md + 2,
      paddingHorizontal: spacing.md + 2,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    rowBottom: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    name: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, flexShrink: 1 },
    time: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
    timeUnread: { fontFamily: fonts.bold, color: colors.primary },
    preview: { fontFamily: fonts.regular, color: colors.muted, flex: 1 },
    previewUnread: { fontFamily: fonts.semibold, color: colors.text },
    badge: { backgroundColor: colors.primary, borderRadius: radius.pill, minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, alignItems: "center" },
    badgeText: { fontFamily: fonts.extrabold, color: colors.onPrimary, fontSize: 12 },
  });
