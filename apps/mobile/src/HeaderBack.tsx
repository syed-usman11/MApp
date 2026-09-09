import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRouter } from "expo-router";
import { Platform, StyleSheet } from "react-native";
import { useSession } from "./session";
import { spacing } from "./theme";
import { PressableScale } from "./ui";
import { useTheme } from "./useTheme";

/**
 * Back control for every stacked screen. Uses navigation history when there
 * is any; otherwise (a page opened by URL on the web, or from a notification)
 * it returns to the chat list or the welcome screen.
 */
export function HeaderBack() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const signedIn = useSession((s) => s.status === "signedIn");

  function goBack() {
    if (navigation.canGoBack()) router.back();
    else router.replace(signedIn ? "/chats" : "/welcome");
  }

  return (
    <PressableScale onPress={goBack} hitSlop={10} scaleTo={0.85} style={styles.button} accessibilityRole="button" accessibilityLabel="Back">
      <Ionicons name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"} size={26} color={colors.primary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { paddingVertical: spacing.xs, paddingRight: spacing.sm, paddingLeft: Platform.OS === "web" ? spacing.xs : 0 },
});
