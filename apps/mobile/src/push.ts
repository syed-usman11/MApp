import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

/**
 * Push registration and the app-icon badge. Everything here is a no-op on the
 * web build and degrades quietly when the project has no EAS project id yet
 * (Expo Go, or a build made before `eas init`), since Expo's push service
 * needs that id to mint a token.
 */

let handlerInstalled = false;

export function installNotificationHandler(): void {
  if (Platform.OS === "web" || handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/** Asks for permission, creates the Android channels, and stores the token on the current device record. */
export async function registerForPush(): Promise<{ token: string | null; reason?: string }> {
  if (Platform.OS === "web") return { token: null, reason: "web" };
  if (!Device.isDevice) return { token: null, reason: "simulator" };
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("messages", {
        name: "Messages",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 200, 100, 200],
        lightColor: "#0B6E4F",
      });
      await Notifications.setNotificationChannelAsync("calls", {
        name: "Calls",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        vibrationPattern: [0, 500, 300, 500, 300, 500],
        lightColor: "#0B6E4F",
        bypassDnd: true,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return { token: null, reason: "denied" };
    const id = projectId();
    if (!id) return { token: null, reason: "no-project-id" };
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await api("/v1/devices/push-token", { body: { token } });
    return { token };
  } catch (err) {
    return { token: null, reason: err instanceof Error ? err.message : "failed" };
  }
}

/** Clears the stored token so a signed-out device stops receiving pushes. */
export async function unregisterPush(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await api("/v1/devices/push-token", { body: { token: null } });
  } catch {
    // Best effort; the server drops dead tokens on its own.
  }
}

export async function setAppBadge(count: number): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // Some launchers don't support badges.
  }
}

export interface NotificationTap {
  conversationId?: string;
  kind?: "message" | "call" | "missed-call";
  callId?: string;
}

/** Fires with the notification's data when the user taps it, including the one that launched the app. */
export function onNotificationTap(handler: (tap: NotificationTap) => void): () => void {
  if (Platform.OS === "web") return () => undefined;
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    handler((response.notification.request.content.data ?? {}) as NotificationTap);
  });
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) handler((response.notification.request.content.data ?? {}) as NotificationTap);
  });
  return () => sub.remove();
}
