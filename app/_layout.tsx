import "../global.css";

import { useCallback, useEffect, useState } from "react";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import { useFonts } from "expo-font";
import { Stack } from "expo-router";

import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AnimatedSplashScreen } from "../components/animated-splash-screen";

import { LoadingSpinner } from "../components/ui";

import { Providers } from "../providers";
import { useAuthStore } from "../store";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

interface RootNavigatorProps {
  fontsLoaded: boolean;
  showAnimatedSplash: boolean;
  onSplashFinish: () => void;
}

const RootNavigator = ({
  fontsLoaded,
  showAnimatedSplash,
  onSplashFinish,
}: RootNavigatorProps) => {
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!fontsLoaded) return null;
  if (showAnimatedSplash) {
    return <AnimatedSplashScreen onFinish={onSplashFinish} />;
  }

  if (!isInitialized) {
    return <LoadingSpinner text="Verificando sessao..." className="bg-white" />;
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />

        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>

        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(protected)" />
        </Stack.Protected>
      </Stack>
    </>
  );
};

const RootLayout = () => {
  const [fontsLoaded] = useFonts({});
  const [showAnimatedSplash, setShowAnimatedSplash] = useState<boolean>(true);

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  const handleSplashFinish = useCallback(() => {
    setShowAnimatedSplash(false);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <Providers>
          <RootNavigator
            fontsLoaded={fontsLoaded}
            showAnimatedSplash={showAnimatedSplash}
            onSplashFinish={handleSplashFinish}
          />
        </Providers>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
};

export default RootLayout;
