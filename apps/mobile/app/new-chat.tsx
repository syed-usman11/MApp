import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { errorMessage } from "../src/api";
import { useChat } from "../src/chatStore";
import { useContacts, type DeviceContact, type MatchedContact } from "../src/contacts";
import { fonts, radius, spacing } from "../src/theme";
import { Avatar, Button, Card, ErrorText, Field, InfoText, Muted, Reveal, SectionLabel, Subtitle, Title } from "../src/ui";
import { useStyles, useTheme, type Theme } from "../src/useTheme";

const MAX_UNREGISTERED = 50;

export default function NewChat() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const openDirect = useChat((st) => st.openDirect);
  const contacts = useContacts();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void contacts.checkPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  async function startWith(target: string, key: string) {
    setBusy(key);
    setError(null);
    try {
      const conv = await openDirect(target);
      router.replace(`/chat/${conv.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function startByUsername() {
    const target = username.trim().toLowerCase().replace(/^@/, "");
    if (target) void startWith(target, "username");
  }

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Reveal>
        <Title>New chat</Title>
        <Subtitle>Pick someone from your contacts or find them by username.</Subtitle>
      </Reveal>

      <Reveal delay={80}>
        <Card>
          <Field
            icon="at-outline"
            label="Username"
            placeholder="username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={startByUsername}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Start chat" icon="chatbubble-outline" onPress={startByUsername} busy={busy === "username"} disabled={!username.trim()} />
        </Card>
      </Reveal>

      <Reveal delay={160}>
        <SectionLabel>From your contacts</SectionLabel>
        <Card style={{ marginTop: spacing.sm }}>
          {notice ? <InfoText icon="time-outline">{notice}</InfoText> : null}
          {contacts.status === "unavailable" ? (
            <InfoText icon="phone-portrait-outline">Contact sync works in the iOS and Android apps. On the web, find people by username.</InfoText>
          ) : null}

          {contacts.status === "undetermined" || contacts.status === "denied" ? (
            <View style={s.permission}>
              <View style={s.permissionIcon}>
                <Ionicons name="people-outline" size={26} color={colors.primary} />
              </View>
              <Text style={s.permissionTitle}>See which contacts are on MApp</Text>
              <Muted>
                Only scrambled (hashed) phone numbers and emails leave your phone. We never upload names or your address book.
              </Muted>
              {contacts.status === "denied" ? (
                <Button title="Open settings to allow" variant="secondary" icon="settings-outline" onPress={() => void Linking.openSettings()} />
              ) : (
                <Button title="Allow contacts access" icon="checkmark" onPress={() => void contacts.requestAndSync()} busy={contacts.loading} />
              )}
            </View>
          ) : null}

          {contacts.status === "granted" ? (
            <>
              <View style={s.syncRow}>
                <Muted>
                  {contacts.loading
                    ? "Checking your contacts…"
                    : `${contacts.registered.length} on MApp · ${contacts.unregistered.length} to invite`}
                </Muted>
                {contacts.loading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={s.link} onPress={() => void contacts.sync()}>
                    Refresh
                  </Text>
                )}
              </View>
              <ErrorText>{contacts.error}</ErrorText>

              {contacts.registered.map((m) => (
                <RegisteredRow key={m.user.id} match={m} busy={busy === m.user.id} onChat={() => void startWith(m.user.username ?? "", m.user.id)} />
              ))}
              {!contacts.loading && contacts.registered.length === 0 && contacts.syncedAt ? (
                <Muted>None of your contacts have joined yet.</Muted>
              ) : null}

              {contacts.unregistered.length > 0 ? <SectionLabel>Invite to MApp</SectionLabel> : null}
              {contacts.unregistered.slice(0, MAX_UNREGISTERED).map((c) => (
                <UnregisteredRow key={c.id} contact={c} onInvite={() => setNotice("Invites are coming soon.")} />
              ))}
              {contacts.unregistered.length > MAX_UNREGISTERED ? (
                <Muted>And {contacts.unregistered.length - MAX_UNREGISTERED} more.</Muted>
              ) : null}
            </>
          ) : null}
        </Card>
      </Reveal>
    </ScrollView>
  );
}

function RegisteredRow({ match, busy, onChat }: { match: MatchedContact; busy: boolean; onChat: () => void }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const canChat = !!match.user.username;
  return (
    <View style={s.row}>
      <Avatar name={match.user.displayName} size={44} />
      <View style={s.flex}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>
            {match.contact.name}
          </Text>
          {match.user.verifiedCountry ? <Ionicons name="shield-checkmark" size={14} color={colors.primary} /> : null}
        </View>
        <Muted>{canChat ? `@${match.user.username}` : `${match.user.displayName} has not picked a username yet`}</Muted>
      </View>
      <Button title="Chat" compact icon="chatbubble-outline" onPress={onChat} busy={busy} disabled={!canChat} />
    </View>
  );
}

function UnregisteredRow({ contact, onInvite }: { contact: DeviceContact; onInvite: () => void }) {
  const s = useStyles(makeStyles);
  const detail = contact.phones[0] ?? contact.emails[0] ?? "";
  return (
    <View style={s.row}>
      <Avatar name={contact.name} size={44} />
      <View style={s.flex}>
        <Text style={s.name} numberOfLines={1}>
          {contact.name}
        </Text>
        <Muted>{detail}</Muted>
      </View>
      <Button title="Invite" compact variant="secondary" icon="paper-plane-outline" onPress={onInvite} />
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.bg, flexGrow: 1 },
    permission: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
    permissionIcon: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
    permissionTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.text, textAlign: "center" },
    syncRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    link: { fontFamily: fonts.bold, color: colors.primary, fontSize: 14 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    name: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, flexShrink: 1 },
  });
