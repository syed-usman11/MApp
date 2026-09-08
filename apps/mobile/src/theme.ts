export type Scheme = "light" | "dark";

export interface Palette {
  primary: string;
  primaryDark: string;
  primarySoft: string;
  accent: string;
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  border: string;
  danger: string;
  dangerSoft: string;
  bubbleMine: string;
  bubbleTheirs: string;
  online: string;
  read: string;
  onPrimary: string;
}

export const palettes: Record<Scheme, Palette> = {
  light: {
    primary: "#4F46E5",
    primaryDark: "#4338CA",
    primarySoft: "#EEF2FF",
    accent: "#F59E0B",
    bg: "#F4F5FA",
    card: "#FFFFFF",
    cardAlt: "#F7F7FC",
    text: "#111827",
    muted: "#6B7280",
    border: "#E5E7EB",
    danger: "#DC2626",
    dangerSoft: "#FEE2E2",
    bubbleMine: "#E0E7FF",
    bubbleTheirs: "#FFFFFF",
    online: "#22C55E",
    read: "#0EA5E9",
    onPrimary: "#FFFFFF",
  },
  dark: {
    primary: "#818CF8",
    primaryDark: "#6366F1",
    primarySoft: "rgba(129,140,248,0.16)",
    accent: "#FBBF24",
    bg: "#0F1020",
    card: "#181A2E",
    cardAlt: "#1F2238",
    text: "#E5E7EB",
    muted: "#9CA3AF",
    border: "#2A2E48",
    danger: "#F87171",
    dangerSoft: "rgba(248,113,113,0.16)",
    bubbleMine: "#2E2A6B",
    bubbleTheirs: "#1F2238",
    online: "#22C55E",
    read: "#7DD3FC",
    onPrimary: "#0F1020",
  },
};

/** Liquid-glass surfaces: translucent colour over a blur. */
export interface Glass {
  bg: string;
  bgStrong: string;
  border: string;
  activePill: string;
  shadow: string;
  tint: "light" | "dark";
}

export function glassFor(scheme: Scheme): Glass {
  return scheme === "dark"
    ? {
        bg: "rgba(21,30,50,0.55)",
        bgStrong: "rgba(11,18,32,0.78)",
        border: "rgba(255,255,255,0.10)",
        activePill: "rgba(129,140,248,0.20)",
        shadow: "0px 12px 32px rgba(0, 0, 0, 0.45)",
        tint: "dark",
      }
    : {
        bg: "rgba(255,255,255,0.62)",
        bgStrong: "rgba(255,255,255,0.80)",
        border: "rgba(255,255,255,0.85)",
        activePill: "rgba(79,70,229,0.12)",
        shadow: "0px 12px 32px rgba(15, 23, 42, 0.16)",
        tint: "light",
      };
}

/** Plus Jakarta Sans, loaded in the root layout. Custom fonts need one family per weight. */
export const fonts = {
  regular: "PlusJakartaSans_400Regular",
  medium: "PlusJakartaSans_500Medium",
  semibold: "PlusJakartaSans_600SemiBold",
  bold: "PlusJakartaSans_700Bold",
  extrabold: "PlusJakartaSans_800ExtraBold",
} as const;

export const layout = {
  topBarHeight: 64,
  tabBarHeight: 66,
  tabBarGap: 12,
};

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/** Shared spring used for taps and pills so the whole app moves the same way. */
// Near critical damping: quick settle, no overshoot.
export const SPRING = { damping: 24, stiffness: 220, mass: 0.6 };
