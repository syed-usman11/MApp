import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";
import { isProfileComplete, type AuthTokens, type Me } from "@mapp/protocol";

const KEY = "mapp.session";

interface Stored {
  user: Me;
  tokens: AuthTokens;
}

async function readStored(): Promise<Stored | null> {
  try {
    const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (!parsed.user || !parsed.tokens) return null;
    // Sessions saved before the profile carried email/phone get safe defaults and are sent to finish their profile.
    return { tokens: parsed.tokens, user: { ...parsed.user, email: parsed.user.email ?? null, phone: parsed.user.phone ?? null } };
  } catch {
    return null;
  }
}

async function writeStored(value: Stored | null): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (value) globalThis.localStorage?.setItem(KEY, JSON.stringify(value));
      else globalThis.localStorage?.removeItem(KEY);
      return;
    }
    if (value) await SecureStore.setItemAsync(KEY, JSON.stringify(value));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Storage failures should never crash the app; the user just signs in again next launch.
  }
}

export interface SessionState {
  status: "loading" | "signedOut" | "signedIn";
  user: Me | null;
  tokens: AuthTokens | null;
  load(): Promise<void>;
  signIn(user: Me, tokens: AuthTokens): Promise<void>;
  setUser(user: Me): Promise<void>;
  setAccessToken(accessToken: string, accessExpiresAt: string): Promise<void>;
  signOut(): Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  user: null,
  tokens: null,

  async load() {
    const stored = await readStored();
    if (stored) set({ status: "signedIn", user: stored.user, tokens: stored.tokens });
    else set({ status: "signedOut", user: null, tokens: null });
  },

  async signIn(user, tokens) {
    await writeStored({ user, tokens });
    set({ status: "signedIn", user, tokens });
  },

  async setUser(user) {
    const { tokens } = get();
    if (tokens) await writeStored({ user, tokens });
    set({ user });
  },

  async setAccessToken(accessToken, accessExpiresAt) {
    const { user, tokens } = get();
    if (!user || !tokens) return;
    const next = { ...tokens, accessToken, accessExpiresAt };
    await writeStored({ user, tokens: next });
    set({ tokens: next });
  },

  async signOut() {
    await writeStored(null);
    set({ status: "signedOut", user: null, tokens: null });
  },
}));

/** Where to send someone after signing in: finish the profile first, then chats. */
export function routeAfterAuth(user: Me): "/chats" | "/profile" {
  return isProfileComplete(user) ? "/chats" : "/profile";
}
