import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { CallOverlay } from "../src/CallOverlay";
import { HeaderBack } from "../src/HeaderBack";
import { unreadTotal, useChat } from "../src/chatStore";
import { installNotificationHandler, onNotificationTap, registerForPush, setAppBadge, unregisterPush } from "../src/push";
import { realtime } from "../src/realtime";
import { useSession } from "../src/session";
import { fonts } from "../src/theme";
import { useThemeStore } from "../src/themeStore";
import { useTheme } from "../src/useTheme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);
installNotificationHandler();

/**
 * Two protected groups: the auth screens exist only while signed out, the app
 * screens only while signed in. Flipping the guard unmounts the other group,
 * so sign-in never leaves the sign-up form underneath the chat list, and
 * sign-out drops straight back to the welcome screen.
 */
export default function RootLayout() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const unread = useChat((s) => unreadTotal(s.conversations));
  const load = useSession((s) => s.load);
  const loadTheme = useThemeStore((s) => s.load);
  const themeReady = useThemeStore((s) => s.hydrated);
  const { colors, isDark } = useTheme();
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    void load();
    void loadTheme();
  }, [load, loadTheme]);

  useEffect(() => {
    if (status === "signedIn") {
      realtime.start();
      void registerForPush();
    } else {
      if (status === "signedOut") void unregisterPush();
      realtime.stop();
      useChat.getState().reset();
    }
  }, [status]);

  // Keep the app icon badge in step with the unread total.
  useEffect(() => {
    if (status === "signedIn") void setAppBadge(unread);
    else if (status === "signedOut") void setAppBadge(0);
  }, [unread, status]);

  // Tapping a notification opens the chat it came from.
  useEffect(() => {
    if (status !== "signedIn") return;
    return onNotificationTap((tap) => {
      if (tap.conversationId) router.push(`/chat/${tap.conversationId}`);
    });
  }, [status, router]);

  const ready = fontsLoaded && themeReady && status !== "loading";
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  const signedIn = status === "signedIn";
  const signedOut = status === "signedOut";

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.primary,
          headerTitleStyle: { fontFamily: fonts.bold, color: colors.text },
          headerBackTitleStyle: { fontFamily: fonts.medium },
          headerShadowVisible: false,
          headerTitleAlign: "left",
          headerLeft: () => <HeaderBack />,
          contentStyle: { backgroundColor: colors.bg },
          animation: Platform.OS === "android" ? "slide_from_right" : "default",
          animationDuration: 260,
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />

        <Stack.Protected guard={signedOut}>
          <Stack.Screen name="welcome" options={{ headerShown: false, animation: "fade" }} />
          <Stack.Screen name="login" options={plainHeader(colors.bg, colors.primary)} />
          <Stack.Screen name="signup" options={plainHeader(colors.bg, colors.primary)} />
          <Stack.Screen name="verify" options={plainHeader(colors.bg, colors.primary)} />
          <Stack.Screen name="forgot" options={plainHeader(colors.bg, colors.primary)} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
        </Stack.Protected>

        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: "fade" }} />
          <Stack.Screen name="chat/[id]" options={{ title: "", headerBackTitle: "Chats" }} />
          <Stack.Screen name="new-chat" options={{ title: "New chat", presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="new-group" options={{ title: "New group", presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="group/[id]" options={{ title: "Group info" }} />
          <Stack.Screen name="search" options={{ title: "Search" }} />
          <Stack.Screen name="user/[username]" options={{ title: "Profile" }} />
          <Stack.Screen name="profile" options={{ title: "Your profile" }} />
        </Stack.Protected>
      </Stack>
      {signedIn ? <CallOverlay /> : null}
    </>
  );
}

function plainHeader(bg: string, tint: string) {
  return { headerStyle: { backgroundColor: bg }, headerTintColor: tint, headerShadowVisible: false, title: "" } as const;
}
