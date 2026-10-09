import "../global.css";

/**
 * Side-effect import, and it has to be here.
 *
 * `TaskManager.defineTask` must run before the OS looks the task up by name,
 * and the launch that matters is the HEADLESS one: the app was killed, the
 * driver's phone is in a cradle, and Android wakes the process with a batch of
 * locations and no screen. Nothing under `(protected)` is imported in that
 * launch — only this file is — so registering the task from the tracking hook
 * would register it exactly when it is not needed.
 */
import "../features/tracking/background-task";

// Also a side-effect import, for the same headless launch: which build this
// is goes with every request, including the ones the tracking flush sends.
import "../utils/client-identity";

import { installGlobalErrorHandler } from "../utils/telemetry";
import { installDiagnosticsReporter } from "../features/diagnostics/install-diagnostics";

import { useCallback, useEffect, useState } from "react";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import { useFonts } from "expo-font";
import { Stack } from "expo-router";

import * as SplashScreen from "expo-splash-screen";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AnimatedSplashScreen } from "../components/animated-splash-screen";

import { LoadingSpinner } from "../components/ui";
import { UpgradeRequiredScreen } from "../components/upgrade-required-screen";

import { Providers } from "../providers";
import { ThemeProvider } from "../providers/theme-provider";
import { useAuthStore } from "../store";
import { useThemeStore } from "../store/theme-store";

// At module load, like the task above: an uncaught error in the headless
// launch has no screen to show it and, until now, no one to tell.
installGlobalErrorHandler();

// Where those reports go: the API's /diagnostics/client, only with a live
// session, at most every few minutes (OBS-12).
installDiagnosticsReporter();

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

interface RootNavigatorProps {
  /** Fonts loaded and the saved theme read. */
  ready: boolean;
  showAnimatedSplash: boolean;
  onSplashFinish: () => void;
}

const RootNavigator = ({
  ready,
  showAnimatedSplash,
  onSplashFinish,
}: RootNavigatorProps) => {
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!ready) return null;
  if (showAnimatedSplash) {
    return <AnimatedSplashScreen onFinish={onSplashFinish} />;
  }

  if (!isInitialized) {
    return <LoadingSpinner text="Verificando sessão..." className="bg-background" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />

      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(protected)" />
      </Stack.Protected>
    </Stack>
  );
};

const RootLayout = () => {
  const [fontsLoaded] = useFonts({});
  const [showAnimatedSplash, setShowAnimatedSplash] = useState<boolean>(true);

  // The saved theme is read before the native splash goes: a driver who
  // picked "Escuro" on a light phone must not see one light frame. The read
  // is one AsyncStorage key, and a failed read still lets the app start.
  const themeHydrated = useThemeStore((state) => state.hydrated);
  const ready = fontsLoaded && themeHydrated;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  const handleSplashFinish = useCallback(() => {
    setShowAnimatedSplash(false);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Outside the sheets' portal and the auth providers: everything
          below, the splash included, sits on the themed background. */}
      <ThemeProvider>
        <BottomSheetModalProvider>
          <Providers>
            <RootNavigator
              ready={ready}
              showAnimatedSplash={showAnimatedSplash}
              onSplashFinish={handleSplashFinish}
            />

            {/* Over every route, the splash and the login included: the first
                426 CLIENT_UPGRADE_REQUIRED any request meets raises it. */}
            <UpgradeRequiredScreen />
          </Providers>
        </BottomSheetModalProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
};

export default RootLayout;
