import React from "react";

import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  Dimensions,
} from "react-native";
import { Button } from "./button";

interface LogoutModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

const { width } = Dimensions.get("window");

export const LogoutModal: React.FC<LogoutModalProps> = ({
  visible,
  onClose,
  onConfirm,
  isLoading = false,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <Pressable
        className="flex-1 bg-black/50 
        justify-center items-center px-6"
        onPress={onClose}
      >
        <Pressable
          className="bg-white rounded-3xl overflow-hidden shadow-2xl"
          style={{ width: Math.min(width - 48, 340) }}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View
            className="bg-gradient-to-r 
            from-gray-50 to-gray-100 
            px-6 pt-6 pb-4"
          >
            <View className="items-center">
              <View
                className="w-16 h-16 bg-gradient-to-br 
                from-danger-100 to-danger-200 rounded-full 
                items-center justify-center mb-4"
              >
                <Text className="text-3xl">👋</Text>
              </View>
              <Text className="text-xl font-bold text-gray-900 mb-2">
                Sair da conta?
              </Text>
              <Text className="text-gray-600 text-center text-sm leading-5">
                Tem certeza que deseja fazer logout? Você precisará inserir suas
                credenciais novamente.
              </Text>
            </View>
          </View>

          {/* Actions */}
          <View className="px-6 py-6 space-y-3 gap-3">
            <Button
              onPress={onConfirm}
              variant="danger"
              loading={isLoading}
              fullWidth
              className="shadow-sm"
            >
              {isLoading ? "Saindo..." : "Confirmar saída"}
            </Button>
            <TouchableOpacity
              onPress={onClose}
              disabled={isLoading}
              className="py-3 bg-gray-100 rounded-lg"
            >
              <Text
                className="text-gray-700 
                text-center font-medium"
              >
                Cancelar
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
