import { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, TouchableOpacity, Linking } from "react-native";

import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "./avatar";
import { useAuthStore } from "../../store";

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
  const { user } = useAuthStore();
  const bottomSheetModalRef = useRef<BottomSheetModal>(null);

  // Snap points para o bottom sheet
  const snapPoints = useMemo(() => ["70%"], []);

  useEffect(() => {
    if (visible) {
      bottomSheetModalRef.current?.present();
    } else {
      bottomSheetModalRef.current?.dismiss();
    }
  }, [visible]);

  // Callback quando o sheet é fechado
  const handleSheetChanges = useCallback(
    (index: number) => {
      if (index === -1) {
        onClose();
      }
    },
    [onClose],
  );

  // Renderizar backdrop customizado
  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

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
      } catch (error) {}
    }
  };

  return (
    <BottomSheetModal
      ref={bottomSheetModalRef}
      index={0}
      snapPoints={snapPoints}
      onChange={handleSheetChanges}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      backgroundStyle={{
        backgroundColor: "#ffffff",
        borderRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: "#d1d5db",
        width: 48,
        height: 6,
      }}
    >
      <BottomSheetView style={{ flex: 1 }}>
        {/* Header */}
        <View className="px-6 pt-2 pb-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-xl font-bold text-gray-900">
              ⚙️ Configurações
            </Text>
            <TouchableOpacity
              onPress={onClose}
              className="w-8 h-8 rounded-full 
              bg-gray-100 items-center justify-center"
            >
              <Text className="text-gray-600 font-bold">×</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* User Profile Section */}
        <View
          className="px-6 py-6 bg-gradient-to-r 
          from-blue-50 to-indigo-50 mx-4 rounded-2xl mb-4"
        >
          <View className="items-center">
            <Avatar
              name={user?.name || "Usuário"}
              avatar={user?.avatar}
              size="xl"
              className="mb-3"
            />
            <Text
              className="text-lg font-bold 
              text-gray-900 text-center mb-1"
            >
              {user?.name || "Usuário"}
            </Text>
            <View className="bg-blue-100 rounded-full px-3 py-1">
              <Text className="text-xs font-medium text-blue-800">
                {getUserRoleDisplay()}
              </Text>
            </View>
          </View>
        </View>

        {/* Email Section */}
        <View className="px-6 py-4 border-b border-gray-100">
          <View className="flex-row items-center">
            <View
              className="w-10 h-10 bg-gray-100 
              rounded-full items-center justify-center mr-4"
            >
              <Text className="text-lg">📧</Text>
            </View>
            <View className="flex-1">
              <Text className="text-sm text-gray-500 mb-1">Email</Text>
              <Text
                className="text-base font-medium text-gray-900"
                numberOfLines={1}
              >
                {user?.email || "email@exemplo.com"}
              </Text>
            </View>
          </View>
        </View>

        {/* Web Platform Section */}
        <TouchableOpacity
          onPress={openWebPlatform}
          className="px-6 py-4 border-b border-gray-100"
          activeOpacity={0.7}
        >
          <View className="flex-row items-center">
            <View
              className="w-10 h-10 bg-blue-100 
              rounded-full items-center justify-center mr-4"
            >
              <Text className="text-lg">🌐</Text>
            </View>
            <View className="flex-1">
              <Text className="text-base font-medium text-gray-900 mb-1">
                Configurar no Web
              </Text>
              <Text className="text-sm text-gray-500">
                Abrir plataforma completa
              </Text>
            </View>
            <Text className="text-blue-500 text-lg">↗️</Text>
          </View>
        </TouchableOpacity>

        {/* Logout Section */}
        <TouchableOpacity
          onPress={() => {
            onClose();
            onLogout();
          }}
          className="px-6 py-4 mb-8"
          activeOpacity={0.7}
        >
          <View className="flex-row items-center">
            <View
              className="w-10 h-10 bg-red-100 
              rounded-full items-center justify-center mr-4"
            >
              <Ionicons
                className="pl-1"
                name="exit-outline"
                size={26}
                color={"#DC143C"}
              />
            </View>
            <View className="flex-1">
              <Text
                className="text-base 
                font-medium text-red-600"
              >
                Sair da Conta
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
};
