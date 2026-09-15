import { Text, TouchableOpacity, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  DRIVER_DELIVERY_STATUS_LABELS,
  formatDeliveryAddress,
} from "@/features/deliveries/delivery-rules";

import type { DriverDelivery } from "@/features/deliveries/types";

const STATUS_CHIP: Record<string, string> = {
  PENDING: "bg-violet-100 text-violet-800",
  IN_TRANSIT: "bg-blue-100 text-blue-800",
};

const formatScheduledDate = (isoDate?: string | null): string | null => {
  if (!isoDate) return null;

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

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
}

/** One stop of the day: who receives, where, and when it is expected. */
const DeliveryCard = ({ delivery, onPress, position }: DeliveryCardProps) => {
  const scheduled = formatScheduledDate(delivery.scheduled_date);
  const chip = STATUS_CHIP[delivery.status] ?? "bg-slate-100 text-slate-800";

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Entrega para ${delivery.recipient_name}`}
      className="mb-3 rounded-xl border border-gray-200 bg-white p-4"
    >
      <View className="flex-row items-start justify-between">
        {position ? (
          <View
            className="mr-3 h-7 w-7 items-center justify-center rounded-full
            bg-blue-100"
            accessibilityLabel={`Parada ${position} da rota`}
          >
            <Text className="text-xs font-bold text-blue-800">{position}</Text>
          </View>
        ) : null}

        <View className="mr-2 flex-1">
          <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
            {delivery.recipient_name}
          </Text>

          {delivery.code ? (
            <Text className="text-xs text-gray-500" numberOfLines={1}>
              Pedido: {delivery.code}
            </Text>
          ) : null}
        </View>

        <View className={`rounded-full px-3 py-1 ${chip.split(" ")[0]}`}>
          <Text className={`text-xs font-medium ${chip.split(" ")[1]}`}>
            {DRIVER_DELIVERY_STATUS_LABELS[delivery.status]}
          </Text>
        </View>
      </View>

      <View className="mt-2 flex-row items-center">
        <Ionicons name="location-outline" size={14} color="#6b7280" />
        <Text className="ml-1 flex-1 text-sm text-gray-600" numberOfLines={2}>
          {formatDeliveryAddress(delivery)}
        </Text>
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs text-gray-500" numberOfLines={1}>
          {delivery.shipper?.name ?? "Sem embarcador"}
        </Text>

        {scheduled ? (
          <View className="flex-row items-center">
            <Ionicons name="calendar-outline" size={13} color="#6b7280" />
            <Text className="ml-1 text-xs text-gray-500">{scheduled}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

export { DeliveryCard };
