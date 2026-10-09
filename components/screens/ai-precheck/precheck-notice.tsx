import { Text, TouchableOpacity, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { useThemeColors } from "@/hooks/use-theme";

interface PrecheckNoticeAction {
  label: string;
  onPress: () => void;
}

interface PrecheckNoticeProps {
  message: string;
  actions: PrecheckNoticeAction[];
  disabled?: boolean;
}

/**
 * The phone's pre-check warning under a photo (decision 14.2): a hint, never
 * a gate. The send button is not touched by it; "Enviar assim" only hides it.
 */
function PrecheckNotice({ message, actions, disabled = false }: PrecheckNoticeProps) {
  const colors = useThemeColors();

  return (
    <View
      className="mb-4 rounded-xl border border-warning/40 bg-warning-soft p-3"
      accessibilityRole="alert"
    >
      <View className="flex-row gap-2">
        <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
        <Text className="flex-1 text-sm text-warning">{message}</Text>
      </View>

      <View className="mt-2 flex-row flex-wrap gap-4">
        {actions.map((action) => (
          <TouchableOpacity
            key={action.label}
            onPress={action.onPress}
            disabled={disabled}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text className="text-sm font-medium text-warning underline">{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export { PrecheckNotice };
export type { PrecheckNoticeAction, PrecheckNoticeProps };
