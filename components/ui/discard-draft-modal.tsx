import Ionicons from "@expo/vector-icons/Ionicons";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

interface DiscardDraftModalProps {
  visible: boolean;
  message: string;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export const DiscardDraftModal = ({
  visible,
  message,
  onClose,
  onConfirm,
  isLoading = false,
}: DiscardDraftModalProps) => {
  const { width } = useWindowDimensions();
  const closeWhenIdle = () => {
    if (!isLoading) onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={closeWhenIdle}
    >
      <Pressable
        accessible={false}
        className="flex-1 items-center justify-center bg-black/50 px-6"
        onPress={closeWhenIdle}
      >
        <Pressable
          accessible
          accessibilityRole="alert"
          accessibilityViewIsModal
          accessibilityLabel={`Descartar rascunho. ${message}`}
          className="overflow-hidden rounded-3xl bg-white shadow-2xl"
          style={{ width: Math.min(width - 48, 340) }}
          onPress={(event) => event.stopPropagation()}
        >
          <View className="bg-gray-50 px-6 pb-4 pt-6">
            <View className="items-center">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-danger-100">
                <Ionicons name="trash-outline" size={30} color="#dc2626" />
              </View>
              <Text className="mb-2 text-xl font-bold text-gray-900">
                Descartar rascunho?
              </Text>
              <Text className="text-center text-sm leading-5 text-gray-600">
                {message}
              </Text>
            </View>
          </View>

          <View className="gap-3 px-6 py-6">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirmar descarte do rascunho"
              accessibilityState={{ disabled: isLoading, busy: isLoading }}
              disabled={isLoading}
              className="min-h-12 flex-row items-center justify-center rounded-lg bg-danger-600 px-4 py-3 disabled:opacity-50"
              onPress={onConfirm}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : null}
              <Text
                className={`font-medium text-white ${isLoading ? "ml-2" : ""}`}
              >
                {isLoading ? "Descartando..." : "Confirmar descarte"}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancelar descarte"
              accessibilityState={{ disabled: isLoading }}
              disabled={isLoading}
              className="min-h-12 items-center justify-center rounded-lg bg-gray-100 px-4 py-3 disabled:opacity-50"
              onPress={onClose}
            >
              <Text className="font-medium text-gray-700">Cancelar</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
