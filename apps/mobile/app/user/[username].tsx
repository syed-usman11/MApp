import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { PublicUser } from "@mapp/protocol";
import { api, errorMessage } from "../../src/api";
import { useCall } from "../../src/callStore";
import { useChat } from "../../src/chatStore";
import { useSession } from "../../src/session";
import { fonts, radius, spacing } from "../../src/theme";
import { Avatar, Button, Card, ErrorText, Loading, Muted, Reveal, Subtitle, Title } from "../../src/ui";
import { useStyles, useTheme, type Theme } from "../../src/useTheme";

/** Public profile reached from search or a group member list. */
export default function UserProfile() {
  const params = useLocalSearchParams<{ username: string }>();
  const username = (Array.isArray(params.username) ? params.username[0] : params.username) ?? "";
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const me = useSession((st) => st.user);
  const presence = useChat((st) => st.presence);
  const conversations = useChat((st) => st.conversations);
  const openDirect = useChat((st) => st.openDirect);
  const loadConversations = useChat((st) => st.loadConversations);
  const startCall = useCall((c) => c.startCall);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (Object.keys(conversations).length === 0) void loadConversations().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!username) return;
    setUser(null);
    setError(null);
    api<PublicUser>(`/v1/users/lookup?username=${encodeURIComponent(username.toLowerCase())}`)
      .then(setUser)
      .catch((e) => setError(errorMessage(e)));
  }, [username]);

  const isMe = user?.id === me?.id;
  const shared = user ? Object.values(conversations).filter((c) => c.type === "group" && c.members.some((m) => m.id === user.id)) : [];

  async function message() {
    if (!user?.username) return;
    setBusy("message");
    try {
      const conv = await openDirect(user.username);
      router.push(`/chat/${conv.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function call() {
    if (!user?.username) return;
    setBusy("call");
    try {
      const conv = await openDirect(user.username);
      await startCall(conv.id, user);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!user && !error) return <Loading />;

  return (
    <ScrollView contentContainerStyle={s.screen}>
      <Stack.Screen options={{ title: user ? user.displayName : "Profile" }} />
      <ErrorText>{error}</ErrorText>
      {user ? (
        <>
          <Reveal>
            <View style={s.hero}>
              <Avatar name={user.displayName} size={112} uri={user.avatarUrl} online={presence[user.id]} />
              <View style={s.nameRow}>
                <Title center>{user.displayName}</Title>
                {user.verifiedCountry ? <Ionicons name="shield-checkmark" size={22} color={colors.primary} /> : null}
              </View>
              <Subtitle center>@{user.username}</Subtitle>
              <View style={s.pills}>
                <View style={[s.pill, presence[user.id] && s.pillOnline]}>
                  <Text style={[s.pillText, presence[user.id] && { color: colors.online }]}>{presence[user.id] ? "Online" : "Offline"}</Text>
                </View>
                {user.verifiedCountry ? (
                  <View style={[s.pill, s.pillVerified]}>
                    <Text style={[s.pillText, { color: colors.primary }]}>Verified · {user.verifiedCountry}</Text>
                  </View>
                ) : (
                  <View style={s.pill}>
                    <Text style={s.pillText}>Not verified</Text>
                  </View>
                )}
              </View>
            </View>
          </Reveal>

          {!isMe ? (
            <Reveal delay={80}>
              <View style={s.actions}>
                <View style={s.flex}>
                  <Button title="Message" icon="chatbubble-outline" onPress={() => void message()} busy={busy === "message"} />
                </View>
                <View style={s.flex}>
                  <Button title="Call" icon="call-outline" variant="secondary" onPress={() => void call()} busy={busy === "call"} />
                </View>
              </View>
            </Reveal>
          ) : (
            <Reveal delay={80}>
              <Button title="Edit your profile" icon="person-outline" variant="secondary" onPress={() => router.push("/profile")} />
            </Reveal>
          )}

          <Reveal delay={160}>
            <Card>
              <Text style={s.cardTitle}>About</Text>
              <Muted>
                {user.verifiedCountry
                  ? "This account was created after a national-ID check, so the person behind it is who they say they are."
                  : "This account signed up with email and password. Identity verification is coming to every account."}
              </Muted>
              {shared.length > 0 ? (
                <>
                  <Text style={s.cardTitle}>Groups in common</Text>
                  {shared.map((c) => (
                    <Text key={c.id} style={s.link} onPress={() => router.push(`/chat/${c.id}`)}>
                      {c.name ?? "Group"} · {c.members.length} members
                    </Text>
                  ))}
                </>
              ) : null}
            </Card>
          </Reveal>
        </>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.bg, flexGrow: 1 },
    hero: { alignItems: "center", gap: spacing.sm },
    nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
    pills: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    pill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
    pillOnline: { borderColor: colors.online },
    pillVerified: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
    pillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.muted },
    actions: { flexDirection: "row", gap: spacing.sm },
    cardTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
    link: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  });
