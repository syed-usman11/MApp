import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { glassFor, palettes, type Glass, type Palette, type Scheme } from "./theme";
import { useThemeStore } from "./themeStore";

export interface Theme {
  scheme: Scheme;
  isDark: boolean;
  colors: Palette;
  glass: Glass;
}

/** Resolves the user's preference ("system" follows the OS) into concrete colours. */
export function useTheme(): Theme {
  const mode = useThemeStore((s) => s.mode);
  const system = useColorScheme();
  const scheme: Scheme = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
  return useMemo(() => ({ scheme, isDark: scheme === "dark", colors: palettes[scheme], glass: glassFor(scheme) }), [scheme]);
}

/** Memoised StyleSheet built from the current theme. Pass a module-level factory so the memo holds. */
export function useStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => factory(theme), [theme, factory]);
}

/** Flip between explicit light and dark. Used by the sun/moon toggle. */
export function useThemeToggle(): { isDark: boolean; toggle: () => void } {
  const { isDark } = useTheme();
  const setMode = useThemeStore((s) => s.setMode);
  return { isDark, toggle: () => setMode(isDark ? "light" : "dark") };
}
