import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeOut } from "react-native-reanimated";
import { errorMessage } from "../../src/api";
import { activeTypers, useChat, type LocalMessage } from "../../src/chatStore";
import { realtime } from "../../src/realtime";
import { useSession } from "../../src/session";
import { fonts, radius, spacing } from "../../src/theme";
import { Avatar, ErrorText, IconButton, InfoText, Loading, Muted, PressableScale, TypingDots } from "../../src/ui";
import { useStyles, useTheme, type Theme } from "../../src/useTheme";

export default function Thread() {
  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const me = useSession((st) => st.user);
  const conversation = useChat((st) => st.conversations[conversationId]);
  const messages = useChat((st) => st.messages[conversationId]);
  const receipts = useChat((st) => st.receipts);
  const presence = useChat((st) => st.presence);
  const typing = useChat((st) => st.typing[conversationId]);
  const connected = useChat((st) => st.connected);
  const loadMessages = useChat((st) => st.loadMessages);
  const loadConversations = useChat((st) => st.loadConversations);
  const addPending = useChat((st) => st.addPending);
  const markFailed = useChat((st) => st.markFailed);
  const clearUnread = useChat((st) => st.clearUnread);

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const typingSentAt = useRef(0);
  const lastReadId = useRef<string | null>(null);
  const [, tick] = useState(0);

  const peer = conversation?.members.find((m) => m.id !== me?.id);

  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      try {
        if (!conversation) await loadConversations();
        await loadMessages(conversationId);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoaded(true);
      }
    })();
  }, [conversationId, conversation, loadConversations, loadMessages]);

  // Send a read receipt for the newest incoming message whenever one appears while this screen is open.
  useEffect(() => {
    if (!messages || !me) return;
    const incoming = [...messages].reverse().find((m) => m.senderId !== me.id && !m.pending);
    if (incoming && incoming.id !== lastReadId.current) {
      lastReadId.current = incoming.id;
      realtime.send({ type: "message.ack", messageId: incoming.id, kind: "read" });
      clearUnread(conversationId);
    }
  }, [messages, me, conversationId, clearUnread]);

  // Re-render so stale typing indicators expire.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const typers = activeTypers(typing).filter((id) => id !== me?.id);
  const isTyping = typers.length > 0;
  const subtitle = isTyping ? "typing" : peer && presence[peer.id] ? "online" : peer ? "offline" : "";

  const data = useMemo(() => [...(messages ?? [])].reverse(), [messages]);

  function onChangeText(next: string) {
    setText(next);
    const now = Date.now();
    if (next.length > 0 && now - typingSentAt.current > 2500) {
      typingSentAt.current = now;
      realtime.send({ type: "typing", conversationId, isTyping: true });
    }
  }

  function send() {
    const body = text.trim();
    if (!body || !me) return;
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    addPending(conversationId, clientId, body, me.id);
    setText("");
    realtime.send({ type: "typing", conversationId, isTyping: false });
    if (!realtime.send({ type: "message.send", clientId, conversationId, body })) {
      markFailed(conversationId, clientId);
      setError("Not connected. The message was not sent.");
    } else {
      setError(null);
    }
  }

  if (!loaded) return <Loading />;

  const canSend = text.trim().length > 0 && connected;

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={88}>
      <Stack.Screen
        options={{
          title: peer?.displayName ?? "Chat",
          headerTitle: () => (
            <View style={s.headerRow}>
              <Avatar name={peer?.displayName ?? "?"} size={34} online={peer ? presence[peer.id] : false} />
              <View>
                <View style={s.headerNameRow}>
                  <Text style={s.headerTitle}>{peer?.displayName ?? "Chat"}</Text>
                  {peer?.verifiedCountry ? <Ionicons name="shield-checkmark" size={14} color={colors.primary} /> : null}
                </View>
                {subtitle ? (
                  <View style={s.headerSubtitleRow}>
                    <Text style={s.headerSubtitle}>{subtitle}</Text>
                    {isTyping ? <TypingDots /> : null}
                  </View>
                ) : null}
              </View>
            </View>
          ),
          headerRight: () => (
            <View style={s.headerActions}>
              <IconButton icon="videocam-outline" size={24} onPress={() => setNotice("Video calls arrive in phase 3.")} label="Video call" />
              <IconButton icon="call-outline" size={22} onPress={() => setNotice("Voice calls arrive in phase 3.")} label="Voice call" />
            </View>
          ),
        }}
      />
      {notice ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={s.notice}>
          <InfoText icon="time-outline">{notice}</InfoText>
        </Animated.View>
      ) : null}
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInUp.delay(Math.min(index, 6) * 30).springify().damping(18)}>
            <Bubble message={item} mine={item.senderId === me?.id} receipt={receipts[item.id]} />
          </Animated.View>
        )}
        contentContainerStyle={s.list}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
            <Muted>No messages yet. Say hello.</Muted>
          </View>
        }
      />
      <ErrorText>{error}</ErrorText>
      <View style={s.composer}>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={onChangeText}
          placeholder={connected ? "Message" : "Connecting…"}
          placeholderTextColor={colors.muted}
          multiline
          onSubmitEditing={send}
          blurOnSubmit
        />
        <PressableScale onPress={send} disabled={!canSend} scaleTo={0.85} style={[s.sendButton, !canSend && s.sendDisabled]} accessibilityLabel="Send">
          <Ionicons name="send" size={20} color={colors.onPrimary} />
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message, mine, receipt }: { message: LocalMessage; mine: boolean; receipt?: { deliveredAt?: string; readAt?: string } }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const status: { icon: "alert-circle" | "time-outline" | "checkmark" | "checkmark-done"; color: string } = message.failed
    ? { icon: "alert-circle", color: colors.danger }
    : message.pending
      ? { icon: "time-outline", color: colors.muted }
      : receipt?.readAt
        ? { icon: "checkmark-done", color: colors.read }
        : receipt?.deliveredAt
          ? { icon: "checkmark-done", color: colors.muted }
          : { icon: "checkmark", color: colors.muted };
  return (
    <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs]}>
      <Text style={s.body}>{message.body}</Text>
      <View style={s.meta}>
        <Text style={s.time}>{time}</Text>
        {mine ? <Ionicons name={status.icon} size={14} color={status.color} /> : null}
      </View>
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    headerNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    headerTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
    headerSubtitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    headerSubtitle: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
    headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    notice: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    list: { padding: spacing.md, gap: 6 },
    empty: { alignItems: "center", gap: spacing.xs, transform: [{ scaleY: -1 }], paddingVertical: spacing.xl },
    bubble: { maxWidth: "80%", borderRadius: radius.xl - 2, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm + 2, borderWidth: 1, borderColor: colors.border },
    bubbleMine: { alignSelf: "flex-end", backgroundColor: colors.bubbleMine, borderBottomRightRadius: 6 },
    bubbleTheirs: { alignSelf: "flex-start", backgroundColor: colors.bubbleTheirs, borderBottomLeftRadius: 6 },
    body: { fontFamily: fonts.regular, fontSize: 16, color: colors.text, lineHeight: 22 },
    meta: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 4 },
    time: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted },
    composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      fontFamily: fonts.regular,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.bg,
    },
    sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
    sendDisabled: { backgroundColor: colors.border },
  });
