import { Text, TouchableOpacity, View } from "react-native";

import { useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import {
  chatContextOfDelivery,
  chatContextParams,
  linkedMessageMoment,
  type LinkedMessagePreview,
} from "@/features/chat/chat-context";
import { useDeliveryChatMessages } from "@/features/chat/hooks/use-delivery-chat-messages";
import { useThemeColors } from "@/hooks/use-theme";

interface DeliveryChatHistoryProps {
  delivery: {
    id: string;
    recipient_name: string;
    stops?: ReadonlyArray<{
      route: { id: string; code: number; name: string | null };
    }> | null;
  };
}

interface DeliveryChatHistoryViewProps {
  messages: LinkedMessagePreview[];
  onOpenChat: () => void;
}

/**
 * What was said about this delivery (decision 6.7): the latest messages of
 * the driver's thread that cite it, with the conversation one tap away. Draws
 * nothing while nothing was said — "Falar com a base" sits right above it.
 */
const DeliveryChatHistoryView = ({
  messages,
  onOpenChat,
}: DeliveryChatHistoryViewProps) => {
  const colors = useThemeColors();

  if (messages.length === 0) return null;

  return (
    <View className="mt-3 rounded-xl border border-border bg-card p-4">
      <Text className="mb-2 text-sm font-semibold text-ink">
        Conversas sobre esta entrega
      </Text>

      {messages.map((message) => (
        <View key={message.id} className="mb-2">
          <Text className="text-xs text-muted">
            {message.who} · {linkedMessageMoment(message.at)}
          </Text>
          <Text className="text-sm text-ink-soft" numberOfLines={2}>
            {message.text}
          </Text>
        </View>
      ))}

      <TouchableOpacity
        onPress={onOpenChat}
        accessibilityRole="button"
        accessibilityLabel="Abrir a conversa sobre esta entrega"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        className="flex-row items-center gap-1 self-start py-1"
      >
        <Ionicons name="chatbubbles-outline" size={14} color={colors.primary} />
        <Text className="text-xs font-medium text-primary">Abrir conversa</Text>
      </TouchableOpacity>
    </View>
  );
};

const DeliveryChatHistory = ({ delivery }: DeliveryChatHistoryProps) => {
  const router = useRouter();
  const messages = useDeliveryChatMessages(delivery.id);

  return (
    <DeliveryChatHistoryView
      messages={messages}
      onOpenChat={() =>
        router.navigate({
          pathname: "/chat",
          params: chatContextParams(chatContextOfDelivery(delivery)),
        })
      }
    />
  );
};

export { DeliveryChatHistory, DeliveryChatHistoryView };
