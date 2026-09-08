import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useTabBarSpace } from "../../src/GlassTabBar";
import { useSession } from "../../src/session";
import { fonts, spacing } from "../../src/theme";
import { TopBar, useTopBarSpace } from "../../src/TopBar";
import { Avatar, Card, IconButton, Muted, Reveal, SectionLabel } from "../../src/ui";
import { useStyles, useTheme, type Theme } from "../../src/useTheme";

export default function Updates() {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const me = useSession((st) => st.user);
  const topSpace = useTopBarSpace();
  const bottomSpace = useTabBarSpace();
  return (
    <View style={s.screen}>
      <TopBar title="Updates" right={<IconButton icon="camera-outline" size={26} onPress={() => undefined} label="Add status" />} />
      <ScrollView contentContainerStyle={[s.content, { paddingTop: topSpace + spacing.md, paddingBottom: bottomSpace }]}>
        <Reveal>
          <SectionLabel>Status</SectionLabel>
          <Card style={{ marginTop: spacing.sm }}>
            <View style={s.myStatus}>
              <View>
                <Avatar name={me?.displayName ?? "?"} size={54} />
                <View style={s.plus}>
                  <Ionicons name="add" size={14} color={colors.onPrimary} />
                </View>
              </View>
              <View style={s.flex}>
                <Text style={s.name}>My status</Text>
                <Muted>Tap to add a status update</Muted>
              </View>
            </View>
          </Card>
        </Reveal>
        <Reveal delay={120}>
          <SectionLabel>Recent updates</SectionLabel>
          <View style={s.empty}>
            <Ionicons name="aperture-outline" size={44} color={colors.border} />
            <Muted>Stories from your contacts will appear here once media sharing lands in phase 2.</Muted>
          </View>
        </Reveal>
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: colors.bg },
    content: { paddingHorizontal: spacing.lg, gap: spacing.md },
    myStatus: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    plus: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    name: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
    empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  });
