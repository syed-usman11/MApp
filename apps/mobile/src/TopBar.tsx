import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, layout, spacing } from "./theme";
import { useStyles, useTheme, type Theme } from "./useTheme";

/** Height a screen must reserve at the top so content starts below the bar. */
export function useTopBarSpace(): number {
  const insets = useSafeAreaInsets();
  return insets.top + layout.topBarHeight;
}

/** Glass top bar for tab screens: optional left slot (profile avatar), large title, right actions. */
export function TopBar({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const s = useStyles(makeStyles);
  const { glass } = useTheme();
  return (
    <BlurView intensity={50} tint={glass.tint} style={[s.bar, { paddingTop: insets.top, height: insets.top + layout.topBarHeight }]}>
      <View style={s.row}>
        {left ? <View style={s.left}>{left}</View> : null}
        <Text style={s.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={s.right}>{right}</View>
      </View>
    </BlurView>
  );
}

const makeStyles = ({ colors, glass, isDark }: Theme) =>
  StyleSheet.create({
    bar: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      backgroundColor: glass.bgStrong,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)",
    },
    row: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, gap: spacing.md },
    left: { marginRight: spacing.xs },
    title: { flex: 1, fontFamily: fonts.extrabold, fontSize: 30, color: colors.text, letterSpacing: -0.5 },
    right: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  });
