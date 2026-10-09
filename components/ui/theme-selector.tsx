import { Text, View } from "react-native";

import type Ionicons from "@expo/vector-icons/Ionicons";

import { useThemePreference } from "../../hooks/use-theme";
import { THEME_OPTIONS, type ThemePreference } from "../../utils/theme-rules";
import { SegmentedControl } from "./segmented-control";

const ICONS: Record<ThemePreference, keyof typeof Ionicons.glyphMap> = {
  light: "sunny-outline",
  dark: "moon-outline",
  system: "phone-portrait-outline",
};

const OPTIONS = THEME_OPTIONS.map((option) => ({ ...option, icon: ICONS[option.value] }));

interface ThemeSelectorProps {
  className?: string;
}

/**
 * "Tema: Claro · Escuro · Sistema", in the settings drawer. The switch is
 * immediate and saved on the phone; "Sistema" follows Android's dark mode.
 */
export const ThemeSelector = ({ className }: ThemeSelectorProps) => {
  const [preference, setPreference] = useThemePreference();

  return (
    <View className={className}>
      <Text className="mb-2 text-sm font-medium text-muted">Tema</Text>
      <SegmentedControl
        options={OPTIONS}
        value={preference}
        onChange={setPreference}
        accessibilityLabel="Tema"
        testID="theme-option"
      />
    </View>
  );
};
