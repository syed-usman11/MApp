import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { logout } from "../../src/authApi";
import { useTabBarSpace } from "../../src/GlassTabBar";
import { useSession } from "../../src/session";
import { fonts, radius, spacing } from "../../src/theme";
import { useThemeStore, type ThemeMode } from "../../src/themeStore";
import { TopBar, useTopBarSpace } from "../../src/TopBar";
import { Avatar, Button, Muted, PressableScale, Reveal, SectionLabel, Segmented, type IconName } from "../../src/ui";
import { useStyles, useTheme, type Theme } from "../../src/useTheme";

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: IconName }> = [
  { value: "system", label: "System", icon: "phone-portrait-outline" },
  { value: "light", label: "Light", icon: "sunny-outline" },
  { value: "dark", label: "Dark", icon: "moon-outline" },
];

export default function Settings() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors, scheme } = useTheme();
  const mode = useThemeStore((st) => st.mode);
  const setMode = useThemeStore((st) => st.setMode);
  const user = useSession((st) => st.user);
  const [busy, setBusy] = useState(false);
  const topSpace = useTopBarSpace();
  const bottomSpace = useTabBarSpace();

  async function signOut() {
    setBusy(true);
    await logout();
  }

  const verified = user?.verifiedCountry ? `Verified · ${user.verifiedCountry}` : "Not verified yet";

  return (
    <View style={s.screen}>
      <TopBar title="Settings" />
      <ScrollView contentContainerStyle={[s.content, { paddingTop: topSpace + spacing.md, paddingBottom: bottomSpace }]}>
        <Reveal>
          <PressableScale onPress={() => router.push("/profile")} scaleTo={0.98} style={s.profile}>
            <Avatar name={user?.displayName ?? "?"} size={64} />
            <View style={s.flex}>
              <View style={s.nameRow}>
                <Text style={s.name}>{user?.displayName}</Text>
                {user?.verifiedCountry ? <Ionicons name="shield-checkmark" size={16} color={colors.primary} /> : null}
              </View>
              <Muted>@{user?.username ?? "no username"}</Muted>
              {user?.email ? <Muted>{user.email}</Muted> : null}
              {user?.phone ? <Muted>{user.phone}</Muted> : null}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.muted} />
          </PressableScale>
        </Reveal>

        <Reveal delay={80}>
          <Section title="Appearance">
            <View style={s.appearance}>
              <View style={s.appearanceRow}>
                <View style={s.rowIcon}>
                  <Ionicons name={scheme === "dark" ? "moon" : "sunny"} size={20} color={colors.primary} />
                </View>
                <View style={s.flex}>
                  <Text style={s.rowLabel}>Theme</Text>
                  <Muted>{mode === "system" ? `Following your device (${scheme})` : `Always ${mode}`}</Muted>
                </View>
              </View>
              <Segmented options={THEME_OPTIONS} value={mode} onChange={setMode} />
            </View>
          </Section>
        </Reveal>

        <Reveal delay={140}>
          <Section title="Account">
            <Row icon="person-outline" label="Profile" value="Name, username and phone" onPress={() => router.push("/profile")} />
            <Row icon="shield-checkmark-outline" label="Identity verification" value={verified} />
            <Row icon="phone-portrait-outline" label="This device" value="Signed in" last />
          </Section>
        </Reveal>

        <Reveal delay={200}>
          <Section title="App">
            <Row icon="notifications-outline" label="Notifications" value="Coming soon" />
            <Row icon="lock-closed-outline" label="Privacy" value="End-to-end encryption in phase 2" last />
          </Section>
        </Reveal>

        <Reveal delay={260}>
          <Button title="Log out" variant="danger" icon="log-out-outline" onPress={() => void signOut()} busy={busy} />
          <Text style={s.version}>MApp 0.1.0</Text>
        </Reveal>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.section}>
      <SectionLabel>{title}</SectionLabel>
      <View style={s.group}>{children}</View>
    </View>
  );
}

function Row({ icon, label, value, onPress, last }: { icon: IconName; label: string; value?: string; onPress?: () => void; last?: boolean }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.row, !last && s.rowBorder, pressed && { opacity: 0.7 }]}>
      <View style={s.rowIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={s.flex}>
        <Text style={s.rowLabel}>{label}</Text>
        {value ? <Muted>{value}</Muted> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
    </Pressable>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    profile: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    name: { fontFamily: fonts.extrabold, fontSize: 18, color: colors.text },
    section: { gap: spacing.sm },
    group: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
    appearance: { padding: spacing.md, gap: spacing.md },
    appearanceRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
    rowLabel: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
    version: { fontFamily: fonts.regular, textAlign: "center", color: colors.muted, fontSize: 12, marginTop: spacing.md },
  });
