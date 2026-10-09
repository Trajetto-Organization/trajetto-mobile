import { Text, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { Button } from "../../ui";
import { useThemeColors } from "../../../hooks/use-theme";

import { formatClock } from "@/features/deliveries/delivery-rules";
import { onTheWayLabel, type OnTheWayView } from "@/features/deliveries/on-the-way-rules";

interface OnTheWayActionProps {
  view: OnTheWayView;
  isSubmitting: boolean;
  onPress: () => void;
}

/**
 * "Estou a caminho" above the stop's actions (decision 6.4): the button while
 * the stop can be marked, then the state — "A caminho desde 14:05" — while it
 * is the one the driver is heading to. Nothing once the stop moved on.
 */
const OnTheWayAction = ({ view, isSubmitting, onPress }: OnTheWayActionProps) => {
  const colors = useThemeColors();

  if (view.current) {
    return (
      <View
        accessibilityRole="text"
        className="mb-2 flex-row items-center justify-center gap-1 rounded-lg
        border border-primary/40 bg-primary-soft px-2 py-2"
      >
        <Ionicons
          name={view.queued ? "time-outline" : "navigate-circle-outline"}
          size={16}
          color={colors.primary}
        />
        <Text
          className="flex-shrink text-center text-xs font-medium text-primary"
          numberOfLines={2}
        >
          {onTheWayLabel(view, formatClock)}
        </Text>
      </View>
    );
  }

  if (!view.offer) return null;

  return (
    <View className="mb-2">
      <Button variant="outline" onPress={onPress} loading={isSubmitting} disabled={isSubmitting} fullWidth>
        Estou a caminho
      </Button>
    </View>
  );
};

export { OnTheWayAction };
