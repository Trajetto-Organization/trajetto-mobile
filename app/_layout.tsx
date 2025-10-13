import "../global.css";

import { useEffect, useState } from "react";
import { Stack } from "expo-router";

import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";

import * as SplashScreen from "expo-splash-screen";

import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import { Providers } from "../providers";
import { AnimatedSplashScreen } from "../components/animated-splash-screen";

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
