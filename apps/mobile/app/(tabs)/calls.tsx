import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTabBarSpace } from "../../src/GlassTabBar";
import { fonts, radius, spacing } from "../../src/theme";
import { TopBar, useTopBarSpace } from "../../src/TopBar";
import { Card, IconButton, Muted, Reveal, SectionLabel } from "../../src/ui";
import { useStyles, useTheme, type Theme } from "../../src/useTheme";

export default function Calls() {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const topSpace = useTopBarSpace();
  const bottomSpace = useTabBarSpace();
  return (
    <View style={s.screen}>
      <TopBar title="Calls" right={<IconButton icon="add-circle-outline" size={28} onPress={() => undefined} label="New call" />} />
      <ScrollView contentContainerStyle={[s.content, { paddingTop: topSpace + spacing.md, paddingBottom: bottomSpace }]}>
        <Reveal>
          <Card>
            <Text style={s.sectionTitle}>Start a call</Text>
            <View style={s.callRow}>
              <CallKind icon="call" label="Voice" />
              <CallKind icon="videocam" label="Video" />
            </View>
            <Muted>Voice and video calls arrive in phase 3 with end-to-end encryption. Chats work today.</Muted>
          </Card>
        </Reveal>
        <Reveal delay={120}>
          <SectionLabel>Recent</SectionLabel>
          <View style={s.empty}>
            <Ionicons name="call-outline" size={44} color={colors.border} />
            <Muted>No calls yet.</Muted>
          </View>
        </Reveal>
      </ScrollView>
    </View>
  );
}

function CallKind({ icon, label }: { icon: "call" | "videocam"; label: string }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={s.callKind}>
      <View style={s.callIcon}>
        <Ionicons name={icon} size={26} color={colors.primary} />
      </View>
      <Text style={s.callLabel}>{label}</Text>
      <Text style={s.soon}>Soon</Text>
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.lg, gap: spacing.md },
    sectionTitle: { fontFamily: fonts.extrabold, fontSize: 17, color: colors.text },
    callRow: { flexDirection: "row", gap: spacing.md },
    callKind: { flex: 1, alignItems: "center", gap: 6, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.cardAlt },
    callIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
    callLabel: { fontFamily: fonts.bold, color: colors.text },
    soon: { fontFamily: fonts.semibold, fontSize: 11, color: colors.muted },
    empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl },
  });
