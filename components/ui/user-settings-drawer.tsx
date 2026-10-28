import { View, Text, TouchableOpacity, Linking } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "./avatar";
import { Sheet } from "./sheet";
import { ThemeSelector } from "./theme-selector";
import { LegalLinks } from "../legal-links";
import { useAuthStore } from "../../store";
import { useThemeColors } from "../../hooks/use-theme";

// The content (profile, e-mail, theme, web, logout, legal) is taller than
// 80% of a 640dp phone, more so with large system fonts: it scrolls inside
// the sheet instead, so "Sair da Conta" is always reachable. A fixed height
// with a scrolling body: dynamic sizing would add no taller snap point.
const SNAP_POINTS = ["80%"];

interface UserSettingsDrawerProps {
  visible: boolean;
  onClose: () => void;
  onLogout: () => void;
}

export const UserSettingsDrawer: React.FC<UserSettingsDrawerProps> = ({
  visible,
  onClose,
  onLogout,
}) => {
  const user = useAuthStore((state) => state.user);
  const colors = useThemeColors();

  const getUserRoleDisplay = () => {
    switch (user?.role) {
      case "MASTER":
        return "Master 👑";
      case "BUSINESS_ADMIN":
        return "Administrador 👑";
      case "BUSINESS_USER":
        // Check if user is a driver
        if (user?.driverId) {
          return "Motorista 🚗";
        }
        return "Colaborador ♦️";
      default:
        return "Colaborador ♦️";
    }
  };

  const openWebPlatform = async () => {
    const webUrl = process.env.EXPO_PUBLIC_WEB_APPLICATION_URL;
    if (webUrl) {
      try {
        await Linking.openURL(webUrl);
      } catch {}
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS}
      scrollTestID="user-settings-scroll"
    >
      {/* Header */}
      <View className="px-6 pt-2 pb-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-ink">⚙️ Configurações</Text>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Fechar configurações"
            className="w-8 h-8 rounded-full 
            bg-subtle items-center justify-center"
          >
            <Text className="text-muted font-bold">×</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* User Profile Section */}
      <View className="px-6 py-6 bg-primary-soft mx-4 rounded-2xl mb-4">
        <View className="items-center">
          <Avatar
            name={user?.name || "Usuário"}
            avatar={user?.avatar}
            size="xl"
            className="mb-3"
          />
          <Text className="text-lg font-bold text-ink text-center mb-1">
            {user?.name || "Usuário"}
          </Text>
          <View className="bg-card rounded-full px-3 py-1">
            <Text className="text-xs font-medium text-primary">
              {getUserRoleDisplay()}
            </Text>
          </View>
        </View>
      </View>

      {/* Email Section */}
      <View className="px-6 py-4 border-b border-border">
        <View className="flex-row items-center">
          <View
            className="w-10 h-10 bg-subtle 
            rounded-full items-center justify-center mr-4"
          >
            <Text className="text-lg">📧</Text>
          </View>
          <View className="flex-1">
            <Text className="text-sm text-muted mb-1">E-mail</Text>
            <Text className="text-base font-medium text-ink" numberOfLines={1}>
              {user?.email || "email@exemplo.com"}
            </Text>
          </View>
        </View>
      </View>

      {/* Theme: immediate, saved on the phone */}
      <ThemeSelector className="px-6 py-4 border-b border-border" />

      {/* Web Platform Section */}
      <TouchableOpacity
        onPress={openWebPlatform}
        className="px-6 py-4 border-b border-border"
        activeOpacity={0.7}
      >
        <View className="flex-row items-center">
          <View
            className="w-10 h-10 bg-primary-soft 
            rounded-full items-center justify-center mr-4"
          >
            <Text className="text-lg">🌐</Text>
          </View>
          <View className="flex-1">
            <Text className="text-base font-medium text-ink mb-1">
              Configurar no Web
            </Text>
            <Text className="text-sm text-muted">
              Abrir plataforma completa
            </Text>
          </View>
          <Text className="text-primary text-lg">↗️</Text>
        </View>
      </TouchableOpacity>

      {/* Logout Section */}
      <TouchableOpacity
        onPress={() => {
          onClose();
          onLogout();
        }}
        testID="logout-button"
        accessibilityRole="button"
        className="px-6 py-4"
        activeOpacity={0.7}
      >
        <View className="flex-row items-center">
          <View
            className="w-10 h-10 bg-destructive-soft 
            rounded-full items-center justify-center mr-4"
          >
            <Ionicons
              className="pl-1"
              name="exit-outline"
              size={26}
              color={colors.destructive}
            />
          </View>
          <View className="flex-1">
            <Text className="text-base font-medium text-destructive">
              Sair da Conta
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* The shared sheet clears the navigation bar below the links. */}
      <LegalLinks className="px-6 pb-4" />
    </Sheet>
  );
};
