import { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";

import { useAuthStore } from "../store";
import { Avatar, UserSettingsDrawer } from "./ui";

import { NotificationBell } from "./notification-bell";

interface HeaderProps {
  pageTitle: string;
  onLogout: () => void;
  onSwitchBusiness?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  pageTitle,
  onLogout,
  onSwitchBusiness,
}) => {
  const user = useAuthStore((state) => state.user);
  const [showUserDrawer, setShowUserDrawer] = useState<boolean>(false);

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

  const getGreeting = () => {
    return "Bem-vindo de volta! 👋";
  };

  const truncateName = (name: string, maxLength: number = 20) => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength) + "...";
  };

  return (
    <>
      <View className="px-6 pt-8">
        <View className="flex-row justify-between items-start">
          <View className="flex-1">
            <Text className="text-sm font-medium text-muted mb-1">{getGreeting()}</Text>
            <Text className="text-2xl font-bold text-ink mb-1" numberOfLines={1}>
              {truncateName(user?.name || "")}
            </Text>
            <View className="flex-row items-center">
              <View className="bg-primary-soft rounded-full px-3 py-1 mr-2">
                <Text className="text-xs font-medium text-primary">
                  {pageTitle}
                </Text>
              </View>
              <View className="bg-subtle border border-border rounded-full px-3 py-1">
                <Text className="text-xs font-medium text-ink-soft">
                  {getUserRoleDisplay()}
                </Text>
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <View className="flex-row items-center space-x-3 gap-2">
            <NotificationBell />

            {/* Switch Business Button - Only for MASTER users */}
            {user?.role === "MASTER" && onSwitchBusiness && (
              <TouchableOpacity
                onPress={onSwitchBusiness}
                className="rounded-full bg-primary-soft"
                style={{
                  width: 40,
                  height: 40,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text className="text-lg">🏢</Text>
              </TouchableOpacity>
            )}

            {/* User Avatar Button */}
            <TouchableOpacity
              onPress={() => setShowUserDrawer(true)}
              testID="user-menu-button"
              accessibilityRole="button"
              accessibilityLabel="Abrir menu do usuário"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Avatar
                name={user?.name || "Usuário"}
                avatar={user?.avatar}
                size="lg"
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* User Settings Drawer */}
      <UserSettingsDrawer
        visible={showUserDrawer}
        onClose={() => setShowUserDrawer(false)}
        onLogout={onLogout}
      />
    </>
  );
};
