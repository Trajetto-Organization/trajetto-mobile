import { useColorScheme } from "nativewind";

import { useThemeStore } from "../store/theme-store";
import {
  themeColors,
  type ColorScheme,
  type ThemeColors,
  type ThemePreference,
} from "../utils/theme-rules";

/**
 * The scheme on screen right now, from NativeWind: the same source the token
 * classes read, so a prop coloured here and a class coloured by CSS variable
 * always switch on the same frame.
 */
export function useColorSchemeName(): ColorScheme {
  const { colorScheme } = useColorScheme();
  return colorScheme === "dark" ? "dark" : "light";
}

/**
 * Token values for props that take a colour instead of a class: Ionicons'
 * `color`, `placeholderTextColor`, ActivityIndicator, bottom sheet styles.
 * Prefer a className whenever the component takes one; only the components
 * that call this re-render on a switch.
 */
export function useThemeColors(): ThemeColors {
  return themeColors(useColorSchemeName());
}

/** The driver's choice (Claro, Escuro, Sistema) and its setter. */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  return [preference, setPreference];
}
