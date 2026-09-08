import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { useChat } from "../src/chatStore";
import { realtime } from "../src/realtime";
import { useSession } from "../src/session";
import { fonts } from "../src/theme";
import { useThemeStore } from "../src/themeStore";
import { useTheme } from "../src/useTheme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Two protected groups: the auth screens exist only while signed out, the app
 * screens only while signed in. Flipping the guard unmounts the other group,
 * so sign-in never leaves the sign-up form underneath the chat list, and
 * sign-out drops straight back to the welcome screen.
 */
export default function RootLayout() {
  const status = useSession((s) => s.status);
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
    } else {
      realtime.stop();
      useChat.getState().reset();
    }
  }, [status]);

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
          <Stack.Screen name="chat/[id]" options={{ headerBackTitle: "Chats" }} />
          <Stack.Screen name="new-chat" options={{ title: "New chat", presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="profile" options={{ title: "Your profile" }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function plainHeader(bg: string, tint: string) {
  return { headerStyle: { backgroundColor: bg }, headerTintColor: tint, headerShadowVisible: false, title: "" } as const;
}
