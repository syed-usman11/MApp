import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PublicUser } from "@mapp/protocol";
import { api, errorMessage } from "../../src/api";
import { useChat } from "../../src/chatStore";
import { pickImage, uploadFile } from "../../src/media";
import { useSession } from "../../src/session";
import { fonts, spacing } from "../../src/theme";
import { Avatar, Button, Card, ErrorText, Field, IconButton, Muted, PressableScale, Reveal, SectionLabel, Subtitle, Title } from "../../src/ui";
import { useStyles, useTheme, type Theme } from "../../src/useTheme";

function confirm(title: string, message: string, onYes: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", style: "destructive", onPress: onYes },
  ]);
}

export default function GroupInfo() {
  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const me = useSession((st) => st.user);
  const conversation = useChat((st) => st.conversations[conversationId]);
  const presence = useChat((st) => st.presence);
  const updateGroup = useChat((st) => st.updateGroup);
  const addMembers = useChat((st) => st.addMembers);
  const removeMember = useChat((st) => st.removeMember);
  const leaveGroup = useChat((st) => st.leaveGroup);
  const loadConversations = useChat((st) => st.loadConversations);

  const [name, setName] = useState(conversation?.name ?? "");
  const [editingName, setEditingName] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversation) void loadConversations();
  }, [conversation, loadConversations]);

  useEffect(() => {
    if (!editingName) setName(conversation?.name ?? "");
  }, [conversation?.name, editingName]);

  const meId = me?.id ?? "";
  const myRole = conversation?.members.find((m) => m.id === meId)?.role ?? "member";
  const isAdmin = myRole === "admin";

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function saveName() {
    const next = name.trim();
    if (!next || next === conversation?.name) {
      setEditingName(false);
      return;
    }
    void run("name", async () => {
      await updateGroup(conversationId, { name: next });
      setEditingName(false);
    });
  }

  function changePhoto() {
    void run("photo", async () => {
      const file = await pickImage();
      if (!file) return;
      const uploaded = await uploadFile(file);
      await updateGroup(conversationId, { avatarMediaId: uploaded.mediaId });
    });
  }

  function addByUsername() {
    const target = username.trim().toLowerCase().replace(/^@/, "");
    if (!target) return;
    void run("add", async () => {
      const user = await api<PublicUser>(`/v1/users/lookup?username=${encodeURIComponent(target)}`);
      await addMembers(conversationId, [user.id]);
      setUsername("");
    });
  }

  function remove(user: PublicUser) {
    confirm("Remove member", `Remove ${user.displayName} from the group?`, () => void run(user.id, () => removeMember(conversationId, user.id)));
  }

  function leave() {
    confirm("Leave group", "You will stop receiving messages from this group.", () =>
      void run("leave", async () => {
        await leaveGroup(conversationId, meId);
        router.replace("/chats");
      }),
    );
  }

  if (!conversation) {
    return (
      <View style={s.centered}>
        <Muted>Loading group…</Muted>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Group info" }} />
      <Reveal>
        <View style={s.hero}>
          <PressableScale onPress={isAdmin ? changePhoto : () => undefined} scaleTo={0.95} disabled={!isAdmin || busy === "photo"} accessibilityLabel="Change group photo">
            <Avatar name={conversation.name ?? "Group"} size={96} uri={conversation.avatarUrl} />
            {isAdmin ? (
              <View style={s.cameraBadge}>
                <Ionicons name="camera" size={14} color={colors.onPrimary} />
              </View>
            ) : null}
          </PressableScale>
          {editingName ? (
            <View style={s.nameEdit}>
              <View style={s.flex}>
                <Field value={name} onChangeText={setName} maxLength={64} autoFocus onSubmitEditing={saveName} />
              </View>
              <Button title="Save" compact onPress={saveName} busy={busy === "name"} />
            </View>
          ) : (
            <View style={s.nameRow}>
              <Title center>{conversation.name ?? "Group"}</Title>
              {isAdmin ? <IconButton icon="pencil-outline" size={20} onPress={() => setEditingName(true)} label="Rename group" /> : null}
            </View>
          )}
          <Subtitle center>
            {conversation.members.length} members · created {new Date(conversation.createdAt).toLocaleDateString()}
          </Subtitle>
        </View>
      </Reveal>

      <ErrorText>{error}</ErrorText>

      {isAdmin ? (
        <Reveal delay={80}>
          <SectionLabel>Add someone</SectionLabel>
          <Card style={{ marginTop: spacing.sm }}>
            <View style={s.addRow}>
              <View style={s.flex}>
                <Field icon="at-outline" placeholder="username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} onSubmitEditing={addByUsername} />
              </View>
              <Button title="Add" compact variant="secondary" onPress={addByUsername} busy={busy === "add"} disabled={!username.trim()} />
            </View>
          </Card>
        </Reveal>
      ) : null}

      <Reveal delay={160}>
        <SectionLabel>Members</SectionLabel>
        <Card style={{ marginTop: spacing.sm }}>
          {conversation.members.map((m) => (
            <PressableScale key={m.id} onPress={() => (m.username ? router.push(`/user/${m.username}`) : undefined)} scaleTo={0.98} style={s.row}>
              <Avatar name={m.displayName} size={44} online={presence[m.id]} uri={m.avatarUrl} />
              <View style={s.flex}>
                <View style={s.memberNameRow}>
                  <Text style={s.name} numberOfLines={1}>
                    {m.id === meId ? "You" : m.displayName}
                  </Text>
                  {m.verifiedCountry ? <Ionicons name="shield-checkmark" size={14} color={colors.primary} /> : null}
                  {m.role === "admin" ? <Text style={s.adminTag}>admin</Text> : null}
                </View>
                <Muted>{m.username ? `@${m.username}` : "No username"}</Muted>
              </View>
              {isAdmin && m.id !== meId ? <IconButton icon="person-remove-outline" size={20} color={colors.danger} onPress={() => remove(m)} label={`Remove ${m.displayName}`} /> : null}
            </PressableScale>
          ))}
        </Card>
      </Reveal>

      <Reveal delay={240}>
        <Button title="Leave group" variant="danger" icon="exit-outline" onPress={leave} busy={busy === "leave"} />
      </Reveal>
    </ScrollView>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
    screen: { padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.bg, flexGrow: 1 },
    hero: { alignItems: "center", gap: spacing.sm },
    cameraBadge: { position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.bg },
    nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    nameEdit: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, width: "100%" },
    addRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
    memberNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
    adminTag: { fontFamily: fonts.semibold, fontSize: 11, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: "hidden" },
  });
