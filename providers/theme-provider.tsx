import { useEffect, useMemo, type ReactNode } from "react";

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
  type Theme,
} from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";

import { useColorSchemeName } from "../hooks/use-theme";
import { useThemeStore } from "../store/theme-store";
import { navigationColors, statusBarStyleFor, themeColors } from "../utils/theme-rules";

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Everything outside the token classes that has to follow the scheme.
 *
 * - React Navigation's theme: the card behind each screen is what shows
 *   during a push and under the keyboard, white unless told otherwise.
 * - The root view's background (expo-system-ui): what Android shows while a
 *   screen is still laying out, and around the keyboard as it animates.
 * - The status bar icons, dark on light and light on dark.
 *
 * Only this subtree's navigators re-render on a switch; screens keep their
 * state, because nothing above them changes identity.
 */
export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const scheme = useColorSchemeName();

  const navigationTheme = useMemo<Theme>(() => {
    const base = scheme === "dark" ? DarkTheme : DefaultTheme;
    return { ...base, dark: scheme === "dark", colors: { ...base.colors, ...navigationColors(scheme) } };
  }, [scheme]);

  // This tree mounts once per Android Activity. A new Activity in the same
  // JS runtime (reopened after back on the root screen) starts with the
  // native night mode reset to "follow system" by expo-system-ui, so the
  // saved choice is applied again. Runs before the root layout hides the
  // splash (child effects first). No-op on a cold start: hydration applies.
  useEffect(() => {
    useThemeStore.getState().reapply();
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(themeColors(scheme).background).catch(() => undefined);
  }, [scheme]);

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style={statusBarStyleFor(scheme)} />
      {children}
    </NavigationThemeProvider>
  );
};
