import { Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  DRIVER_DELIVERY_STATUS_LABELS,
  formatClock,
  formatDeliveryAddress,
} from "@/features/deliveries/delivery-rules";
import { onTheWayLabel, type OnTheWayView } from "@/features/deliveries/on-the-way-rules";

import type { DriverDelivery } from "@/features/deliveries/types";
import { formatDateOnly } from "@/utils/formatters";
import { useThemeColors } from "@/hooks/use-theme";

import { OccurrenceAuthorizationBadge } from "../occurrences/occurrence-authorization-card";

// Token pairs (docs/arquitetura.md, theme section): each reads at 4.5:1 in both themes. Designated
// is neutral on purpose: pink and violet identify modules, not states.
const STATUS_CHIP: Record<string, { box: string; text: string }> = {
  PENDING: { box: "border border-border bg-subtle", text: "text-ink-soft" },
  IN_TRANSIT: { box: "bg-primary-soft", text: "text-primary" },
};

const DEFAULT_CHIP = { box: "border border-border bg-subtle", text: "text-ink-soft" };

interface DeliveryCardProps {
  delivery: DriverDelivery;
  onPress: () => void;

  /**
   * Which address this is in the order the dispatcher chose, or null when the
   * delivery is not on a route. The POSITION, never the stored sequence —
   * those are spaced by ten so a stop can be dropped between two others, and
   * "parada 20 de 6" would be nonsense.
   */
  position?: number | null;

  /**
   * "A caminho" for this stop (decision 6.4), the same view the delivery
   * screen reads (`useOnTheWay().viewFor`). Only the state is shown here; the
   * button stays on the delivery screen.
   */
  onTheWay?: OnTheWayView | null;
}

/** One stop of the day: who receives, where, and when it is expected. */
const DeliveryCard = ({ delivery, onPress, position, onTheWay }: DeliveryCardProps) => {
  // A day, not an instant (decision 1.3): read in UTC, or the phone's zone
  // showed the 16th for a delivery expected on the 17th.
  const scheduled = formatDateOnly(delivery.scheduled_date);
  const chip = STATUS_CHIP[delivery.status] ?? DEFAULT_CHIP;
  const colors = useThemeColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      testID={`delivery-card-${delivery.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Entrega para ${delivery.recipient_name}`}
      className="mb-3 rounded-xl border border-border bg-card p-4"
    >
      <View className="flex-row items-start justify-between">
        {position ? (
          <View
            className="mr-3 h-7 w-7 items-center justify-center rounded-full
            bg-primary-soft"
            accessibilityLabel={`Parada ${position} da rota`}
          >
            <Text className="text-xs font-bold text-primary">{position}</Text>
          </View>
        ) : null}

        <View className="mr-2 flex-1">
          <Text className="text-base font-semibold text-ink" numberOfLines={1}>
            {delivery.recipient_name}
          </Text>

          {delivery.code ? (
            <Text className="text-xs text-muted" numberOfLines={1}>
              Pedido: {delivery.code}
            </Text>
          ) : null}
        </View>

        <View className={`rounded-full px-3 py-1 ${chip.box}`}>
          <Text className={`text-xs font-medium ${chip.text}`}>
            {DRIVER_DELIVERY_STATUS_LABELS[delivery.status]}
          </Text>
        </View>
      </View>

      <View className="mt-2 flex-row items-center">
        <Ionicons name="location-outline" size={14} color={colors.muted} />
        <Text className="ml-1 flex-1 text-sm text-muted" numberOfLines={2}>
          {formatDeliveryAddress(delivery)}
        </Text>
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs text-muted" numberOfLines={1}>
          {delivery.shipper?.name ?? "Sem embarcador"}
        </Text>

        {scheduled ? (
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={13} color={colors.muted} />
            <Text className="ml-1 text-xs text-muted">{scheduled}</Text>
          </View>
        ) : null}
      </View>

      {onTheWay?.current ? (
        <View
          accessibilityRole="text"
          className="mt-2 flex-row items-center self-start rounded-full bg-primary-soft px-2 py-1"
        >
          <Ionicons
            name={onTheWay.queued ? "time-outline" : "navigate-circle-outline"}
            size={13}
            color={colors.primary}
          />
          <Text className="ml-1 text-xs font-medium text-primary" numberOfLines={1}>
            {onTheWayLabel(onTheWay, formatClock)}
          </Text>
        </View>
      ) : null}

      {/* "Aguardando autorização da torre" and its answer (decision 6.3). */}
      <OccurrenceAuthorizationBadge delivery={delivery} />
    </TouchableOpacity>
  );
};

export { DeliveryCard };
