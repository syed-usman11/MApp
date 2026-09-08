import { Tabs } from "expo-router";
import { GlassTabBar, type TabBarProps } from "../../src/GlassTabBar";
import { useTheme } from "../../src/useTheme";

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{ headerShown: false, animation: "shift", sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={(props) => <GlassTabBar {...(props as unknown as TabBarProps)} />}
    >
      <Tabs.Screen name="chats" options={{ title: "Chats" }} />
      <Tabs.Screen name="calls" options={{ title: "Calls" }} />
      <Tabs.Screen name="updates" options={{ title: "Updates" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
