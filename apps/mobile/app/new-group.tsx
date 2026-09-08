import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { PublicUser } from "@mapp/protocol";
import { api, errorMessage } from "../src/api";
import { useChat } from "../src/chatStore";
import { useContacts } from "../src/contacts";
import { useSession } from "../src/session";
import { fonts, radius, spacing } from "../src/theme";
import { Avatar, Button, Card, ErrorText, Field, InfoText, Muted, PressableScale, Reveal, SectionLabel, Subtitle, Title } from "../src/ui";
import { useStyles, useTheme, type Theme } from "../src/useTheme";

/**
 * Pick people and name the group. Candidates come from matched contacts and
 * from everyone you already share a chat with; anyone else can be added by
 * username.
 */
export default function NewGroup() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const me = useSession((st) => st.user);
  const conversations = useChat((st) => st.conversations);
  const createGroup = useChat((st) => st.createGroup);
  const contacts = useContacts();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [picked, setPicked] = useState<Record<string, PublicUser>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    void contacts.checkPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const candidates = useMemo(() => {
    const map = new Map<string, PublicUser>();
    for (const c of Object.values(conversations)) for (const m of c.members) if (m.id !== me?.id) map.set(m.id, m);
    for (const m of contacts.registered) map.set(m.user.id, m.user);
    return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [conversations, contacts.registered, me?.id]);

  function toggle(user: PublicUser) {
    setPicked((p) => {
      const next = { ...p };
      if (next[user.id]) delete next[user.id];
      else next[user.id] = user;
      return next;
    });
  }

  async function addByUsername() {
    const target = username.trim().toLowerCase().replace(/^@/, "");
    if (!target) return;
    setLookingUp(true);
    setError(null);
    try {
      const user = await api<PublicUser>(`/v1/users/lookup?username=${encodeURIComponent(target)}`);
      if (user.id === me?.id) throw new Error("That's you");
      setPicked((p) => ({ ...p, [user.id]: user }));
      setUsername("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLookingUp(false);
    }
  }

  async function create() {
    const ids = Object.keys(picked);
    if (!name.trim() || ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const conv = await createGroup(name.trim(), ids);
      router.replace(`/chat/${conv.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const pickedList = Object.values(picked);

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Reveal>
        <Title>New group</Title>
        <Subtitle>Name it, then pick who's in.</Subtitle>
      </Reveal>

      <Reveal delay={80}>
        <Card>
          <Field icon="people-outline" label="Group name" placeholder="Weekend plans" value={name} onChangeText={setName} maxLength={64} />
          {pickedList.length > 0 ? (
            <View style={s.chips}>
              {pickedList.map((u) => (
                <PressableScale key={u.id} onPress={() => toggle(u)} scaleTo={0.9} style={s.chip} accessibilityLabel={`Remove ${u.displayName}`}>
                  <Avatar name={u.displayName} size={22} uri={u.avatarUrl} />
                  <Text style={s.chipText}>{u.displayName}</Text>
                  <Ionicons name="close" size={14} color={colors.muted} />
                </PressableScale>
              ))}
            </View>
          ) : (
            <Muted>Nobody picked yet.</Muted>
          )}
          <ErrorText>{error}</ErrorText>
          <Button title={`Create group${pickedList.length ? ` (${pickedList.length + 1})` : ""}`} icon="checkmark" onPress={() => void create()} busy={busy} disabled={!name.trim() || pickedList.length === 0} />
        </Card>
      </Reveal>

      <Reveal delay={160}>
        <SectionLabel>Add by username</SectionLabel>
        <Card style={{ marginTop: spacing.sm }}>
          <View style={s.lookupRow}>
            <View style={s.flex}>
              <Field icon="at-outline" placeholder="username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => void addByUsername()} />
            </View>
            <Button title="Add" compact variant="secondary" onPress={() => void addByUsername()} busy={lookingUp} disabled={!username.trim()} />
          </View>
        </Card>
      </Reveal>

      <Reveal delay={240}>
        <SectionLabel>People you know</SectionLabel>
        <Card style={{ marginTop: spacing.sm }}>
          {candidates.length === 0 ? <InfoText icon="person-add-outline">Start a chat or sync contacts to see people here, or add them by username above.</InfoText> : null}
          {candidates.map((u) => {
            const on = !!picked[u.id];
            return (
              <PressableScale key={u.id} onPress={() => toggle(u)} scaleTo={0.98} style={s.row} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Avatar name={u.displayName} size={44} uri={u.avatarUrl} />
                <View style={s.flex}>
                  <Text style={s.name} numberOfLines={1}>
                    {u.displayName}
                  </Text>
                  <Muted>{u.username ? `@${u.username}` : "No username yet"}</Muted>
                </View>
                <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={26} color={on ? colors.primary : colors.border} />
              </PressableScale>
            );
          })}
        </Card>
      </Reveal>
    </ScrollView>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.bg, flexGrow: 1 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingLeft: 4, paddingRight: 8, paddingVertical: 4 },
    chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
    lookupRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
    name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  });
