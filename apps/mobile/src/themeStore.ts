import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "mapp.theme";

interface ThemeState {
  mode: ThemeMode;
  hydrated: boolean;
  load(): Promise<void>;
  setMode(mode: ThemeMode): void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: "system",
  hydrated: false,

  async load() {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw === "light" || raw === "dark" || raw === "system") set({ mode: raw, hydrated: true });
      else set({ hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setMode(mode) {
    set({ mode });
    AsyncStorage.setItem(KEY, mode).catch(() => undefined);
  },
}));
