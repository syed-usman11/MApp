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
    primary: "#0B6E4F",
    primaryDark: "#08503A",
    primarySoft: "#E3F4EC",
    accent: "#2ED18A",
    bg: "#F2F4F7",
    card: "#FFFFFF",
    cardAlt: "#F7F8FA",
    text: "#0F172A",
    muted: "#64748B",
    border: "#E2E8F0",
    danger: "#DC2626",
    dangerSoft: "#FEE2E2",
    bubbleMine: "#D9F5E7",
    bubbleTheirs: "#FFFFFF",
    online: "#22C55E",
    read: "#2563EB",
    onPrimary: "#FFFFFF",
  },
  dark: {
    primary: "#34D399",
    primaryDark: "#10B981",
    primarySoft: "rgba(52,211,153,0.16)",
    accent: "#6EE7B7",
    bg: "#0B1220",
    card: "#151E32",
    cardAlt: "#1B2540",
    text: "#E5E7EB",
    muted: "#94A3B8",
    border: "#243049",
    danger: "#F87171",
    dangerSoft: "rgba(248,113,113,0.16)",
    bubbleMine: "#0F4C3A",
    bubbleTheirs: "#1B2540",
    online: "#22C55E",
    read: "#60A5FA",
    onPrimary: "#052E22",
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
        activePill: "rgba(52,211,153,0.18)",
        shadow: "0px 12px 32px rgba(0, 0, 0, 0.45)",
        tint: "dark",
      }
    : {
        bg: "rgba(255,255,255,0.62)",
        bgStrong: "rgba(255,255,255,0.80)",
        border: "rgba(255,255,255,0.85)",
        activePill: "rgba(11,110,79,0.13)",
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
export const SPRING = { damping: 16, stiffness: 220, mass: 0.6 };
