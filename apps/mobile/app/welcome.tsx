import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { pingServer } from "../src/api";
import { API_URL } from "../src/config";
import { fonts, radius, spacing } from "../src/theme";
import { AuthScreen, Brand, Button, Feature, IconButton, Reveal, Subtitle, Title } from "../src/ui";
import { useStyles, useTheme, useThemeToggle, type Theme } from "../src/useTheme";

export default function Welcome() {
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const { isDark, toggle } = useThemeToggle();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => pingServer().then((ok) => !cancelled && setOnline(ok));
    void check();
    const t = setInterval(() => void check(), 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <AuthScreen>
      <View style={s.toggleRow}>
        <IconButton icon={isDark ? "sunny-outline" : "moon-outline"} size={24} onPress={toggle} label="Toggle dark mode" />
      </View>
      <Reveal style={s.hero}>
        <Brand size={92} />
        <Title center>Simple, private messaging</Title>
        <Subtitle center>Fast chats with the people you know, built to add verified identities as it grows.</Subtitle>
      </Reveal>
      <View style={s.features}>
        <Reveal delay={120}>
          <Feature icon="chatbubble-ellipses-outline" title="Fast, reliable chat" text="Delivery and read receipts, typing and presence." />
        </Reveal>
        <Reveal delay={200}>
          <Feature icon="lock-closed-outline" title="Private by design" text="Your email is never shown to other users." />
        </Reveal>
        <Reveal delay={280}>
          <Feature icon="shield-checkmark-outline" title="Verified identities" text="National-ID verification is coming to every account." />
        </Reveal>
      </View>
      <Reveal delay={360} style={s.actions}>
        <Button title="Create account" onPress={() => router.push("/signup")} icon="arrow-forward" />
        <Button title="Log in" variant="secondary" onPress={() => router.push("/login")} />
      </Reveal>
      {__DEV__ ? (
        <Reveal delay={440} style={[s.status, online === false && s.statusBad]}>
          <Ionicons name={online ? "cloud-done-outline" : online === false ? "cloud-offline-outline" : "cloud-outline"} size={16} color={online === false ? colors.danger : colors.muted} />
          <Text style={[s.statusText, online === false && { color: colors.danger }]} numberOfLines={2}>
            {online === null ? `Checking server ${API_URL}` : online ? `Server reachable · ${API_URL}` : `Server unreachable · ${API_URL}. Same Wi-Fi? Firewall open on 4000?`}
          </Text>
        </Reveal>
      ) : null}
    </AuthScreen>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    toggleRow: { flexDirection: "row", justifyContent: "flex-end" },
    hero: { alignItems: "center", gap: spacing.lg, marginTop: spacing.md },
    features: { gap: spacing.lg, marginTop: spacing.md },
    actions: { gap: spacing.md, marginTop: spacing.xl },
    status: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.cardAlt, marginTop: spacing.md },
    statusBad: { backgroundColor: colors.dangerSoft },
    statusText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, flex: 1 },
  });
