import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPRING, fonts, layout, radius } from "./theme";
import type { IconName } from "./ui";
import { useStyles, useTheme, type Theme } from "./useTheme";

interface TabRoute {
  key: string;
  name: string;
}

/** The subset of React Navigation's tab-bar props this component uses. */
export interface TabBarProps {
  state: { index: number; routes: TabRoute[] };
  navigation: {
    emit(event: { type: "tabPress"; target: string; canPreventDefault: true }): { defaultPrevented: boolean };
    navigate(name: string): void;
  };
}

const TABS: Record<string, { label: string; icon: IconName; iconActive: IconName }> = {
  chats: { label: "Chats", icon: "chatbubbles-outline", iconActive: "chatbubbles" },
  calls: { label: "Calls", icon: "call-outline", iconActive: "call" },
  updates: { label: "Updates", icon: "aperture-outline", iconActive: "aperture" },
  settings: { label: "Settings", icon: "settings-outline", iconActive: "settings" },
};

const PAD = 6;
const GAP = 4;

/** Bottom padding a scrolling screen needs so its last row clears the floating bar. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return layout.tabBarHeight + layout.tabBarGap + Math.max(insets.bottom, 8) + 16;
}

/**
 * Floating, translucent tab bar in the style of the iOS 26+ "liquid glass"
 * bars: blurred backdrop, soft border, and a tinted pill that springs to the
 * active tab.
 */
export function GlassTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const s = useStyles(makeStyles);
  const { colors, glass } = useTheme();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const tabWidth = width > 0 ? (width - PAD * 2 - GAP * (count - 1)) / count : 0;

  const x = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    if (tabWidth <= 0) return;
    const target = PAD + state.index * (tabWidth + GAP);
    // First layout: park the pill under the active tab. After that, spring between tabs.
    if (!placed.current) {
      placed.current = true;
      x.value = target;
    } else {
      x.value = withSpring(target, SPRING);
    }
  }, [state.index, tabWidth, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={[s.wrap, { pointerEvents: "box-none", bottom: Math.max(insets.bottom, 8) + layout.tabBarGap }]}>
      <View style={s.shadow}>
        <BlurView intensity={60} tint={glass.tint} experimentalBlurMethod="dimezisBlurView" style={s.bar} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {tabWidth > 0 ? <Animated.View style={[s.pill, { width: tabWidth }, pill]} /> : null}
          {state.routes.map((route, index) => {
            const meta = TABS[route.name] ?? { label: route.name, icon: "ellipse-outline" as IconName, iconActive: "ellipse" as IconName };
            const focused = state.index === index;
            const onPress = () => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };
            return (
              <TabItem
                key={route.key}
                label={meta.label}
                icon={focused ? meta.iconActive : meta.icon}
                focused={focused}
                color={focused ? colors.primary : colors.muted}
                onPress={onPress}
                style={s.tab}
                labelStyle={[s.label, focused && { color: colors.primary }]}
              />
            );
          })}
        </BlurView>
      </View>
    </View>
  );
}

function TabItem({
  label,
  icon,
  focused,
  color,
  onPress,
  style,
  labelStyle,
}: {
  label: string;
  icon: IconName;
  focused: boolean;
  color: string;
  onPress: () => void;
  style: object;
  labelStyle: unknown;
}) {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withSpring(focused ? 1.12 : 1, SPRING);
  }, [focused, scale]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label} style={style}>
      <Animated.View style={iconStyle}>
        <Ionicons name={icon} size={22} color={color} />
      </Animated.View>
      <Text style={labelStyle as never}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = ({ colors, glass }: Theme) =>
  StyleSheet.create({
    wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
    shadow: { width: "100%", maxWidth: 520, borderRadius: radius.pill, boxShadow: glass.shadow },
    bar: {
      flexDirection: "row",
      height: layout.tabBarHeight,
      borderRadius: radius.pill,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.bg,
      padding: PAD,
      gap: GAP,
    },
    pill: { position: "absolute", top: PAD, bottom: PAD, left: 0, borderRadius: radius.pill, backgroundColor: glass.activePill },
    tab: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, gap: 2 },
    label: { fontFamily: fonts.semibold, fontSize: 11, color: colors.muted },
  });
