import {
  Dimensions,
  Modal,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Button } from "./button";

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: "primary" | "danger";
  /** Big glyph in the header circle, like the logout modal's wave. */
  emoji?: string;
  /** Keeps the modal open with a spinning button while the action runs. */
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const { width } = Dimensions.get("window");

/**
 * The app's one confirmation look, mirroring the logout modal: emoji
 * circle, bold title, a full-width action and a quiet cancel underneath.
 * Every confirmation goes through here so none of them drifts back to the
 * bare system-looking card.
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  visible,
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  confirmVariant = "primary",
  emoji,
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const headerEmoji = emoji ?? (confirmVariant === "danger" ? "⚠️" : "✅");

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (!isLoading) onCancel();
      }}
    >
      <Pressable
        className="flex-1 bg-black/50 justify-center items-center px-6"
        onPress={() => {
          if (!isLoading) onCancel();
        }}
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
                className={`w-16 h-16 rounded-full items-center
                justify-center mb-4 bg-gradient-to-br ${
                  confirmVariant === "danger"
                    ? "from-danger-100 to-danger-200"
                    : "from-primary-100 to-primary-200"
                }`}
              >
                <Text className="text-3xl">{headerEmoji}</Text>
              </View>
              <Text className="text-xl font-bold text-gray-900 mb-2 text-center">
                {title}
              </Text>
              <Text className="text-gray-600 text-center text-sm leading-5">
                {message}
              </Text>
            </View>
          </View>

          {/* Actions */}
          <View className="px-6 py-6 gap-3">
            <Button
              onPress={onConfirm}
              variant={confirmVariant}
              loading={isLoading}
              disabled={isLoading}
              fullWidth
              className="shadow-sm"
            >
              {confirmText}
            </Button>
            <TouchableOpacity
              onPress={onCancel}
              disabled={isLoading}
              className={`py-3 bg-gray-100 rounded-lg ${isLoading ? "opacity-50" : ""}`}
            >
              <Text
                className="text-gray-700
                text-center font-medium"
              >
                {cancelText}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};
