import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Where the API lives. In development we derive the host from wherever the
 * JS bundle came from, so a physical phone, the Android emulator, and the web
 * build opened through the PC's LAN address all reach the same machine.
 * Override with EXPO_PUBLIC_API_URL.
 */
function devHost(): string {
  // Web: the address the user actually typed (localhost on the PC, 192.168.x.x on a phone).
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }
  // Native: Metro's address as seen by the device, e.g. "192.168.1.4:8081".
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) return hostUri.split(":")[0] ?? "localhost";
  if (Platform.OS === "android") return "10.0.2.2";
  return "localhost";
}

/** Deployed API, used by production builds (web export, release APK) when EXPO_PUBLIC_API_URL is not set. */
const PRODUCTION_API_URL = "https://mapp-api-2p5c.onrender.com";

export const IS_DEV_BUILD = typeof __DEV__ !== "undefined" && __DEV__;

export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? (IS_DEV_BUILD ? `http://${devHost()}:4000` : PRODUCTION_API_URL)
).replace(/\/+$/, "");
export const WS_URL = `${API_URL.replace(/^http/, "ws")}/ws`;
