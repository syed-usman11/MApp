import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Conversation, Message, PublicUser } from "@mapp/protocol";
import { api, errorMessage } from "../src/api";
import { conversationLabel, previewOf, useChat } from "../src/chatStore";
import { useSession } from "../src/session";
import { fonts, radius, spacing } from "../src/theme";
import { Avatar, ErrorText, Field, Muted, PressableScale, SectionLabel } from "../src/ui";
import { useStyles, useTheme, type Theme } from "../src/useTheme";

/** Global search: chats by name plus every message you can see, straight from the server. */
export default function Search() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const me = useSession((st) => st.user);
  const conversations = useChat((st) => st.conversations);
  const search = useChat((st) => st.search);
  const meId = me?.id ?? "";
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ messages: Message[]; conversations: Conversation[] } | null>(null);
  const [person, setPerson] = useState<PublicUser | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    const id = ++latest.current;
    const t = setTimeout(async () => {
      setBusy(true);
      // A single token can be a username: look it up alongside the message search.
      const handle = term.replace(/^@/, "").toLowerCase();
      const lookup = /^[a-z0-9_.]{2,}$/.test(handle) ? api<PublicUser>(`/v1/users/lookup?username=${encodeURIComponent(handle)}`).catch(() => null) : Promise.resolve(null);
      try {
        const [res, found] = await Promise.all([search(term), lookup]);
        if (id === latest.current) {
          setResults(res);
          setPerson(found && found.id !== meId ? found : null);
          setError(null);
        }
      } catch (e) {
        if (id === latest.current) setError(errorMessage(e));
      } finally {
        if (id === latest.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, search, meId]);
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of Object.values(conversations)) for (const m of c.members) map.set(m.id, m.displayName);
    return (id: string) => (id === meId ? "You" : (map.get(id) ?? "Unknown"));
  }, [conversations, meId]);

  return (
    <View style={s.screen}>
      <Stack.Screen options={{ title: "Search" }} />
      <View style={s.searchBar}>
        <Field icon="search-outline" pill placeholder="Search messages and chats" value={q} onChangeText={setQ} autoFocus autoCapitalize="none" autoCorrect={false} />
      </View>
      <ScrollView contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
        <ErrorText>{error}</ErrorText>
        {busy ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} /> : null}
        {!results && !person && !busy ? (
          <View style={s.empty}>
            <Ionicons name="search-outline" size={40} color={colors.border} />
            <Muted>Type at least two characters.</Muted>
          </View>
        ) : null}
        {person ? (
          <>
            <SectionLabel>People</SectionLabel>
            <PressableScale onPress={() => router.push(`/user/${person.username}`)} scaleTo={0.98} style={s.row} accessibilityLabel={`Open ${person.displayName}'s profile`}>
              <Avatar name={person.displayName} size={48} uri={person.avatarUrl} />
              <View style={s.flex}>
                <View style={s.personRow}>
                  <Text style={s.name} numberOfLines={1}>
                    {person.displayName}
                  </Text>
                  {person.verifiedCountry ? <Ionicons name="shield-checkmark" size={14} color={colors.primary} /> : null}
                </View>
                <Muted>@{person.username} · View profile</Muted>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </PressableScale>
          </>
        ) : null}
        {results && results.conversations.length > 0 ? (
          <>
            <SectionLabel>Chats</SectionLabel>
            {results.conversations.map((c) => {
              const label = conversationLabel(c, meId);
              return (
                <PressableScale key={c.id} onPress={() => router.push(`/chat/${c.id}`)} scaleTo={0.98} style={s.row}>
                  <Avatar name={label.name} size={44} uri={label.avatarUrl} />
                  <View style={s.flex}>
                    <Text style={s.name} numberOfLines={1}>
                      {label.name}
                    </Text>
                    <Muted>{c.type === "group" ? `${c.members.length} members` : previewOf(c.lastMessage) || "No messages yet"}</Muted>
                  </View>
                </PressableScale>
              );
            })}
          </>
        ) : null}
        {results && results.messages.length > 0 ? (
          <>
            <SectionLabel>Messages</SectionLabel>
            {results.messages.map((m) => {
              const conv = conversations[m.conversationId];
              const where = conv ? conversationLabel(conv, meId).name : "Chat";
              return (
                <PressableScale key={m.id} onPress={() => router.push(`/chat/${m.conversationId}`)} scaleTo={0.98} style={s.row}>
                  <Avatar name={nameOf(m.senderId)} size={40} />
                  <View style={s.flex}>
                    <View style={s.msgTop}>
                      <Text style={s.name} numberOfLines={1}>
                        {nameOf(m.senderId)}
                        <Text style={s.where}> in {where}</Text>
                      </Text>
                      <Text style={s.time}>{new Date(m.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</Text>
                    </View>
                    <Highlight text={m.attachment && !m.body ? m.attachment.name : previewOf(m)} term={q.trim()} />
                  </View>
                </PressableScale>
              );
            })}
          </>
        ) : null}
        {results && results.messages.length === 0 && results.conversations.length === 0 && !person && !busy ? (
          <View style={s.empty}>
            <Ionicons name="file-tray-outline" size={40} color={colors.border} />
            <Muted>Nothing matches "{q.trim()}".</Muted>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  const s = useStyles(makeStyles);
  const idx = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (idx === -1) {
    return (
      <Text style={s.preview} numberOfLines={2}>
        {text}
      </Text>
    );
  }
  return (
    <Text style={s.preview} numberOfLines={2}>
      {text.slice(0, idx)}
      <Text style={s.match}>{text.slice(idx, idx + term.length)}</Text>
      {text.slice(idx + term.length)}
    </Text>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: colors.bg },
    searchBar: { padding: spacing.lg, paddingBottom: spacing.sm },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
    empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
    name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
    personRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    where: { fontFamily: fonts.regular, color: colors.muted },
    msgTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    time: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
    preview: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted, marginTop: 2 },
    match: { fontFamily: fonts.bold, color: colors.primary },
  });
