import React from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StatusBar,
  Pressable,
} from "react-native";

interface SwitchBusinessModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  currentBusiness?: string;
  isLoading?: boolean;
}

export const SwitchBusinessModal: React.FC<SwitchBusinessModalProps> = ({
  visible,
  onClose,
  onConfirm,
  currentBusiness,
  isLoading = false,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar backgroundColor="rgba(0,0,0,0.5)" barStyle="light-content" />

      {/* Backdrop */}
      <Pressable
        className="flex-1 bg-black/50 
        justify-center items-center px-6"
        onPress={onClose}
      >
        {/* Modal Content */}
        <Pressable
          className="bg-white rounded-3xl 
          p-6 w-full max-w-sm shadow-2xl"
          onPress={(e) => e.stopPropagation()}
        >
          {/* Icon */}
          <View className="items-center mb-6">
            <View
              className="w-14 h-14 bg-gradient-to-br 
              from-blue-500 to-blue-600 rounded-full
              items-center justify-center shadow-lg"
            >
              <Text className="text-4xl">🏢</Text>
            </View>
          </View>

          {/* Title */}
          <Text
            className="text-2xl font-bold 
            text-gray-900 text-center mb-3"
          >
            Trocar Empresa
          </Text>

          {/* Description */}
          <Text
            className="text-gray-600 
            text-center mb-2 leading-6"
          >
            Deseja sair da empresa atual e selecionar uma nova?
          </Text>

          {/* Current Business */}
          {currentBusiness && (
            <View className="bg-gray-50 rounded-2xl p-4 mb-6">
              <Text
                className="text-xs text-gray-500 
                uppercase tracking-wide mb-1 text-center"
              >
                Empresa Atual
              </Text>
              <Text
                className="text-sm font-medium 
                text-gray-900 text-center"
                numberOfLines={2}
              >
                {currentBusiness}
              </Text>
            </View>
          )}

          {/* Buttons */}
          <View className="flex-row space-x-3 gap-2">
            {/* Cancel Button */}
            <TouchableOpacity
              onPress={onClose}
              disabled={isLoading}
              className="flex-1 bg-gray-100 
              rounded-2xl py-4 px-6 "
            >
              <Text
                className="text-gray-700 
                font-semibold text-center"
              >
                Cancelar
              </Text>
            </TouchableOpacity>

            {/* Confirm Button */}
            <TouchableOpacity
              onPress={onConfirm}
              disabled={isLoading}
              className={`flex-1 rounded-2xl py-4 px-6 ${
                isLoading ? "bg-blue-300" : "bg-blue-500"
              }`}
              style={{
                backgroundColor: isLoading ? "#93C5FD" : "#3B82F6",
              }}
            >
              <Text
                className="text-white 
                font-semibold text-center"
              >
                {isLoading ? "Trocando..." : "Confirmar"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Help Text */}
          <Text
            className="text-xs text-gray-400 
            text-center mt-4 leading-4"
          >
            Você será redirecionado para a tela de seleção de empresas
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
