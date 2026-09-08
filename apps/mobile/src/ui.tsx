import { Ionicons } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import Animated, {
  FadeInDown,
  ZoomIn,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SPRING, fonts, radius, spacing } from "./theme";
import { useStyles, useTheme, type Theme } from "./useTheme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable that shrinks slightly under the finger and springs back. */
export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  onPressIn,
  onPressOut,
  ...props
}: PressableProps & { style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, SPRING);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, SPRING);
        onPressOut?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** Fades and slides content up into place. Stagger with `delay`. */
export function Reveal({ delay = 0, children, style }: PropsWithChildren<{ delay?: number; style?: StyleProp<ViewStyle> }>) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify().damping(24).stiffness(140)} style={style}>
      {children}
    </Animated.View>
  );
}

/** Scrollable, keyboard-aware page used by every auth screen. Content is capped at a phone width on web. */
export function AuthScreen({ children, footer }: PropsWithChildren<{ footer?: ReactNode }>) {
  const s = useStyles(makeStyles);
  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled">
        <View style={s.authContent}>{children}</View>
        {footer ? (
          <Reveal delay={240} style={s.authFooter}>
            {footer}
          </Reveal>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Brand({ size = 64, horizontal = false }: { size?: number; horizontal?: boolean }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Animated.View entering={ZoomIn.springify().damping(24).stiffness(140)} style={[s.brand, horizontal ? s.brandRow : s.brandColumn]}>
      <View style={[s.brandMark, { width: size, height: size, borderRadius: size * 0.3 }]}>
        <Ionicons name="chatbubbles" size={size * 0.52} color={colors.onPrimary} />
      </View>
      <Text style={[s.brandName, { fontSize: horizontal ? size * 0.5 : size * 0.42 }]}>MApp</Text>
    </Animated.View>
  );
}

export function Title({ children, center }: PropsWithChildren<{ center?: boolean }>) {
  const s = useStyles(makeStyles);
  return <Text style={[s.title, center && s.center]}>{children}</Text>;
}

export function Subtitle({ children, center }: PropsWithChildren<{ center?: boolean }>) {
  const s = useStyles(makeStyles);
  return <Text style={[s.subtitle, center && s.center]}>{children}</Text>;
}

export function Muted({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const s = useStyles(makeStyles);
  return <Text style={[s.muted, style as never]}>{children}</Text>;
}

export function SectionLabel({ children }: PropsWithChildren) {
  const s = useStyles(makeStyles);
  return <Text style={s.sectionLabel}>{children}</Text>;
}

export function ErrorText({ children }: { children?: string | null }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  if (!children) return null;
  return (
    <Animated.View entering={FadeInDown.springify().damping(24).stiffness(140)} style={s.errorBox}>
      <Ionicons name="alert-circle" size={18} color={colors.danger} />
      <Text style={s.errorText}>{children}</Text>
    </Animated.View>
  );
}

export function InfoText({ children, icon = "information-circle" }: { children?: string | null; icon?: IconName }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  if (!children) return null;
  return (
    <Animated.View entering={FadeInDown.springify().damping(24).stiffness(140)} style={s.infoBox}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={s.infoText}>{children}</Text>
    </Animated.View>
  );
}

export function TextLink({ children, onPress }: PropsWithChildren<{ onPress: () => void }>) {
  const s = useStyles(makeStyles);
  return (
    <Text style={s.link} onPress={onPress}>
      {children}
    </Text>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  title,
  onPress,
  disabled,
  busy,
  variant = "primary",
  icon,
  compact,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: ButtonVariant;
  icon?: IconName;
  compact?: boolean;
}) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    secondary: { bg: colors.card, fg: colors.primary, border: colors.border },
    ghost: { bg: "transparent", fg: colors.primary, border: "transparent" },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerSoft },
  }[variant];
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || busy}
      style={[s.button, compact && s.buttonCompact, { backgroundColor: palette.bg, borderColor: palette.border }, (disabled || busy) && s.buttonDisabled]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={s.buttonInner}>
          <Text style={[s.buttonText, { color: palette.fg }]}>{title}</Text>
          {icon ? <Ionicons name={icon} size={18} color={palette.fg} /> : null}
        </View>
      )}
    </PressableScale>
  );
}

export function IconButton({ icon, onPress, color, size = 22, label }: { icon: IconName; onPress: () => void; color?: string; size?: number; label?: string }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} hitSlop={10} scaleTo={0.85} style={s.iconButton} accessibilityLabel={label} accessibilityRole="button">
      <Ionicons name={icon} size={size} color={color ?? colors.primary} />
    </PressableScale>
  );
}

const webInputReset = Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as ViewStyle) : null;

export function Field({
  label,
  icon,
  error,
  secureTextEntry,
  pill,
  ...props
}: TextInputProps & { label?: string; icon?: IconName; error?: string | null; pill?: boolean }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const [hidden, setHidden] = useState(!!secureTextEntry);
  const focus = useSharedValue(0);
  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [error ? colors.danger : colors.border, error ? colors.danger : colors.primary]),
  }));
  return (
    <View style={s.field}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <Animated.View style={[s.inputRow, pill && s.inputRowPill, borderStyle]}>
        {icon ? <Ionicons name={icon} size={20} color={colors.muted} /> : null}
        <TextInput
          placeholderTextColor={colors.muted}
          {...props}
          secureTextEntry={hidden}
          onFocus={(e) => {
            focus.value = withTiming(1, { duration: 180 });
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            focus.value = withTiming(0, { duration: 180 });
            props.onBlur?.(e);
          }}
          style={[s.input, webInputReset, props.style]}
        />
        {secureTextEntry ? (
          <PressableScale
            onPress={() => setHidden((h) => !h)}
            hitSlop={12}
            scaleTo={0.85}
            style={s.eyeButton}
            accessibilityRole="button"
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
          >
            <Ionicons name={hidden ? "eye-outline" : "eye-off-outline"} size={22} color={hidden ? colors.muted : colors.primary} />
          </PressableScale>
        ) : null}
      </Animated.View>
      {error ? <Text style={s.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const s = useStyles(makeStyles);
  return <View style={[s.card, style]}>{children}</View>;
}

export function Loading({ label }: { label?: string }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={s.centered}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text style={s.muted}>{label}</Text> : null}
    </View>
  );
}

const AVATAR_COLORS = ["#0B6E4F", "#1D4ED8", "#B45309", "#7C3AED", "#BE185D", "#0E7490", "#4D7C0F"];

export function Avatar({ name, size = 44, online, uri }: { name: string; size?: number; online?: boolean; uri?: string | null }) {
  const s = useStyles(makeStyles);
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <View style={{ width: size, height: size }}>
      <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, overflow: "hidden" }]}>
        {uri ? (
          <ExpoImage source={{ uri }} style={{ width: size, height: size }} contentFit="cover" transition={120} />
        ) : (
          <Text style={[s.avatarText, { fontSize: size * 0.4 }]}>{initials || "?"}</Text>
        )}
      </View>
      {online ? (
        <Animated.View entering={ZoomIn.springify().damping(24).stiffness(140)} style={[s.presenceDot, { width: size * 0.28, height: size * 0.28, borderRadius: size * 0.14 }]} />
      ) : null}
    </View>
  );
}

export function Feature({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={s.feature}>
      <View style={s.featureIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <View style={s.flex}>
        <Text style={s.featureTitle}>{title}</Text>
        <Text style={s.muted}>{text}</Text>
      </View>
    </View>
  );
}

export function Steps({ current, total, label }: { current: number; total: number; label: string }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.steps}>
      <View style={s.stepsBar}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[s.stepSegment, i < current && s.stepSegmentDone]} />
        ))}
      </View>
      <Text style={s.stepsLabel}>
        Step {current} of {total} · {label}
      </Text>
    </View>
  );
}

/** Three bouncing dots, the classic "someone is typing" signal. */
export function TypingDots({ color }: { color?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 3, alignItems: "flex-end", height: 10 }}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} delay={i * 140} color={color ?? colors.muted} />
      ))}
    </View>
  );
}

function Dot({ delay, color }: { delay: number; color: string }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(delay, withRepeat(withSequence(withTiming(-4, { duration: 240 }), withTiming(0, { duration: 240 })), -1, false));
  }, [delay, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }, style]} />;
}

/** Segmented control with a pill that springs to the selected option. */
export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string; icon?: IconName }>; value: T; onChange: (v: T) => void }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = width > 0 ? (width - 8) / options.length : 0;
  const x = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    if (segment <= 0) return;
    if (!placed.current) {
      placed.current = true;
      x.value = index * segment;
    } else {
      x.value = withSpring(index * segment, SPRING);
    }
  }, [index, segment, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={s.segmented} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {segment > 0 ? <Animated.View style={[s.segmentPill, { width: segment }, pill]} /> : null}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={s.segment} accessibilityRole="button" accessibilityState={{ selected: active }}>
            {o.icon ? <Ionicons name={o.icon} size={16} color={active ? colors.primary : colors.muted} /> : null}
            <Text style={[s.segmentText, active && { color: colors.primary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    center: { textAlign: "center" },
    centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl, backgroundColor: colors.bg },
    authScroll: { flexGrow: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
    authContent: { width: "100%", maxWidth: 460, alignSelf: "center", gap: spacing.lg },
    authFooter: { width: "100%", maxWidth: 460, alignSelf: "center", alignItems: "center", marginTop: spacing.xl, paddingBottom: spacing.lg },
    brand: { alignItems: "center", gap: spacing.md },
    brandColumn: { flexDirection: "column" },
    brandRow: { flexDirection: "row" },
    brandMark: { backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
    brandName: { fontFamily: fonts.extrabold, color: colors.primary, letterSpacing: -0.5 },
    title: { fontFamily: fonts.extrabold, fontSize: 28, color: colors.text, letterSpacing: -0.3 },
    subtitle: { fontFamily: fonts.regular, fontSize: 16, color: colors.muted, lineHeight: 22, marginTop: 4 },
    muted: { fontFamily: fonts.regular, color: colors.muted, fontSize: 14, lineHeight: 20 },
    sectionLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.8 },
    errorBox: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.dangerSoft, padding: spacing.md, borderRadius: radius.md },
    errorText: { fontFamily: fonts.medium, color: colors.danger, fontSize: 14, flex: 1, lineHeight: 20 },
    infoBox: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", backgroundColor: colors.primarySoft, padding: spacing.md, borderRadius: radius.md },
    infoText: { fontFamily: fonts.medium, color: colors.primary, fontSize: 14, flex: 1, lineHeight: 20 },
    link: { fontFamily: fonts.bold, color: colors.primary, fontSize: 14 },
    button: { height: 50, paddingHorizontal: spacing.lg, borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1 },
    buttonCompact: { height: 42, paddingHorizontal: spacing.md },
    buttonInner: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { fontFamily: fonts.bold, fontSize: 16 },
    iconButton: { padding: spacing.xs },
    field: { gap: 6 },
    label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      minHeight: 50,
    },
    inputRowPill: { borderRadius: radius.pill, paddingHorizontal: spacing.lg },
    input: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.text, paddingVertical: spacing.md },
    eyeButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, marginRight: -6 },
    fieldError: { fontFamily: fonts.medium, color: colors.danger, fontSize: 13 },
    card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
    avatar: { alignItems: "center", justifyContent: "center" },
    avatarText: { fontFamily: fonts.bold, color: "#fff" },
    presenceDot: { position: "absolute", right: -1, bottom: -1, backgroundColor: colors.online, borderWidth: 2, borderColor: colors.card },
    feature: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
    featureIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
    featureTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.text, marginBottom: 2 },
    steps: { gap: spacing.sm },
    stepsBar: { flexDirection: "row", gap: 6 },
    stepSegment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
    stepSegmentDone: { backgroundColor: colors.primary },
    stepsLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted },
    segmented: { flexDirection: "row", backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: colors.border },
    segmentPill: { position: "absolute", top: 4, bottom: 4, left: 4, borderRadius: radius.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: radius.sm },
    segmentText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted },
  });
