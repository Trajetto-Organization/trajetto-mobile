import { Text, TouchableOpacity, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import {
  chatDeliveryLabel,
  chatRouteLabel,
} from "@/features/chat/chat-context";

import type { ClientChatMessage } from "@/features/chat/types";
import { bubbleTones } from "@/features/chat/bubble-tones";
import { useThemeColors } from "@/hooks/use-theme";

interface ChatMessageContextTagsProps {
  delivery: ClientChatMessage["delivery"];
  route?: ClientChatMessage["route"];

  /**
   * Delivery id → order code, from the cached day (`deliveryCodeIndex`): the
   * API's chat payload names the delivery by recipient only.
   */
  deliveryCodes?: ReadonlyMap<string, string>;

  /** The driver's own (blue) bubble: the tags take its light-on-dark tones. */
  isMine: boolean;

  onPressDelivery: (deliveryId: string) => void;
}

/**
 * What a message is about, on top of its bubble (decision 6.7): the delivery
 * chip, which opens the delivery, and the route the message was said during.
 *
 * The route is a plain label, not a button: the app has no route screen to
 * open, and the driver's list already groups the stops by route.
 */
const ChatMessageContextTags = ({
  delivery,
  route,
  deliveryCodes,
  isMine,
  onPressDelivery,
}: ChatMessageContextTagsProps) => {
  const tones = bubbleTones(useThemeColors(), isMine);

  if (!delivery && !route) return null;

  const deliveryLabel = delivery
    ? chatDeliveryLabel({
        recipient: delivery.recipient_name,
        code: deliveryCodes?.get(delivery.id),
      })
    : "";

  return (
    <View className="mb-1.5 gap-1">
      {delivery && (
        <TouchableOpacity
          onPress={() => onPressDelivery(delivery.id)}
          accessibilityRole="button"
          accessibilityLabel={`Abrir entrega de ${deliveryLabel}`}
          className={`flex-row items-center gap-1.5 rounded-lg px-2 py-1.5 ${
            // A shade darker than the blue bubble it sits on, so the chip
            // still reads as a button there.
            isMine ? "bg-black/20" : "bg-subtle"
          }`}
        >
          <Ionicons name="cube-outline" size={14} color={tones.tint} />
          <Text
            numberOfLines={1}
            className={`flex-1 text-xs ${isMine ? "text-primary-foreground" : "text-ink-soft"}`}
          >
            Entrega: {deliveryLabel}
          </Text>
        </TouchableOpacity>
      )}

      {route && (
        <View
          className="flex-row items-center gap-1 px-0.5"
          accessibilityLabel={`Mensagem da ${chatRouteLabel(route)}`}
        >
          <Ionicons name="map-outline" size={12} color={tones.meta} />
          <Text
            numberOfLines={1}
            className={`flex-shrink text-[11px] ${
              isMine ? "text-primary-foreground/95" : "text-muted"
            }`}
          >
            {chatRouteLabel(route)}
          </Text>
        </View>
      )}
    </View>
  );
};

export { ChatMessageContextTags };
