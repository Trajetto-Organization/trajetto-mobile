import AsyncStorage from "@react-native-async-storage/async-storage";
import { colorScheme } from "nativewind";

import { createThemeStore } from "./create-theme-store";

/**
 * The driver's theme choice, saved on the phone (default "system").
 *
 * NativeWind's colorScheme.set flips its CSS variables (every token class
 * restyles in place, no remount) and, through React Native's Appearance,
 * Android's night mode, so native dialogs such as the date picker follow.
 * "system" hands the choice back to the phone.
 */
export const useThemeStore = createThemeStore(AsyncStorage, (preference) => {
  colorScheme.set(preference);
});
