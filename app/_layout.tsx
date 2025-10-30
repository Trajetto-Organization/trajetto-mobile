import "../global.css";

import { Stack } from "expo-router";
import { useEffect, useState } from "react";

import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";

import * as SplashScreen from "expo-splash-screen";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AnimatedSplashScreen } from "../components/animated-splash-screen";
import { Providers } from "../providers";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const RootLayout = () => {
  const [loaded] = useFonts({
    // Add your custom fonts here if needed
  });

  const [showAnimatedSplash, setShowAnimatedSplash] = useState<boolean>(true);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  const handleSplashFinish = () => {
    setShowAnimatedSplash(false);
  };

  if (!loaded) {
    return null;
  }

  if (showAnimatedSplash) {
    return <AnimatedSplashScreen onFinish={handleSplashFinish} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <Providers>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerShown: false,
            }}
          />
        </Providers>
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
};

export default RootLayout;
