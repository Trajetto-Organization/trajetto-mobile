import { palette } from "./theme-tokens";

/**
 * What the driver picked in Configurações → Tema. "system" follows Android's
 * dark mode, and is the default: a driver who never opens the setting gets
 * what the rest of the phone does.
 */
export type ThemePreference = "light" | "dark" | "system";

/** The scheme actually painted. */
export type ColorScheme = "light" | "dark";

export type ThemeColors = (typeof palette)["light"];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/** The selector's options, in the order the web shows them. */
export const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

/**
 * A stored value back into a preference. Anything unknown (an older build's
 * key, a corrupted write) falls back to the default instead of crashing the
 * first frame.
 */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_THEME_PREFERENCE;
}

/**
 * The scheme to paint. Android reports null/undefined when it has no
 * preference (old versions, some launchers): light then, like the platform.
 */
export function resolveColorScheme(
  preference: ThemePreference,
  system: string | null | undefined,
): ColorScheme {
  if (preference !== "system") return preference;
  return system === "dark" ? "dark" : "light";
}

/** Colour values for props that take no class (icons, placeholders, sheets). */
export function themeColors(scheme: ColorScheme): ThemeColors {
  return palette[scheme];
}

/**
 * expo-status-bar's style names the ICONS: dark icons over the light theme,
 * light icons over the dark one. Never "auto": that reads the system scheme,
 * which is wrong whenever the driver picked the other one by hand.
 */
export function statusBarStyleFor(scheme: ColorScheme): "light" | "dark" {
  return scheme === "dark" ? "light" : "dark";
}

/**
 * React Navigation's colours, so the stack's own card behind every screen
 * (seen during a transition, or under a screen shorter than the window) is
 * the page background and never a white flash in the dark theme.
 */
export function navigationColors(scheme: ColorScheme) {
  const colors = palette[scheme];

  return {
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.ink,
    border: colors.border,
    notification: colors.destructiveSurface,
  };
}

export type ToastKind = "success" | "error" | "info";

/**
 * react-native-toast-message's cards are hard-coded white with black text:
 * these are the token colours they take instead. The accent stripe is the
 * readable colour of the kind, so it still reads on the dark card.
 */
export function toastColors(scheme: ColorScheme, kind: ToastKind) {
  const colors = palette[scheme];
  const accent = { success: colors.success, error: colors.destructive, info: colors.primary }[kind];

  return {
    background: colors.card,
    border: colors.border,
    accent,
    title: colors.ink,
    message: colors.muted,
  };
}

/** Where the segmented control's thumb was (or is going), in px. */
export interface ThumbPlacement {
  index: number;
  segmentWidth: number;
}

/**
 * Whether the thumb slides or jumps to its new place. It slides only when the
 * driver picks another option on a track already measured at the same width.
 * Everything else jumps: the first measurement (the drawer unmounts its
 * content on close, so every opening is one — sliding there would cross from
 * "Claro" to "Sistema" each time), a rotation or a width change.
 */
export function segmentedThumbMotion(
  previous: ThumbPlacement | null,
  next: ThumbPlacement,
): "snap" | "animate" | "none" {
  if (next.segmentWidth <= 0) return "none";
  if (!previous || previous.segmentWidth !== next.segmentWidth) return "snap";
  return previous.index === next.index ? "none" : "animate";
}
