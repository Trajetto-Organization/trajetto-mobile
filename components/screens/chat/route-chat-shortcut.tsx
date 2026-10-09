import { Text, TouchableOpacity, View } from "react-native";

import { useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import {
  chatContextOfRoute,
  chatContextParams,
  chatRouteLabel,
  linkedMessageMoment,
  type LinkedMessagePreview,
} from "@/features/chat/chat-context";
import { useRouteChatMessages } from "@/features/chat/hooks/use-delivery-chat-messages";
import { useThemeColors } from "@/hooks/use-theme";

interface RouteRef {
  id: string;
  code: number;
  name: string | null;
}

interface RouteChatShortcutProps {
  route: RouteRef;
}

interface RouteChatShortcutViewProps {
  route: RouteRef;
  messages: LinkedMessagePreview[];
  onOpenChat: () => void;
}

/**
 * A route's conversation, in its section of the list (decision 6.7: the
 * route shows its messages): the latest lines said about it or its stops,
 * one each so the list stays a list, and "Falar com a base" about the whole
 * route. The app has no route screen; the section is where the driver looks
 * at a route.
 */
const RouteChatShortcutView = ({
  route,
  messages,
  onOpenChat,
}: RouteChatShortcutViewProps) => {
  const colors = useThemeColors();

  return (
    <View className="mt-1">
      {messages.length > 0 ? (
        <View className="mt-1 rounded-lg border border-border bg-card px-3 py-2">
          <Text className="mb-1 text-xs font-semibold text-ink-soft">
            Conversas sobre esta rota
          </Text>

          {messages.map((message) => (
            <Text key={message.id} className="text-xs text-muted" numberOfLines={1}>
              {`${message.who} · ${linkedMessageMoment(message.at)} — ${message.text}`}
            </Text>
          ))}
        </View>
      ) : null}

      <TouchableOpacity
        onPress={onOpenChat}
        accessibilityRole="button"
        accessibilityLabel={`Falar com a base sobre a ${chatRouteLabel(route)}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        className="mt-1 flex-row items-center gap-1 self-start py-1"
      >
        <Ionicons name="chatbubbles-outline" size={14} color={colors.primary} />
        <Text className="text-xs font-medium text-primary">
          Falar com a base sobre esta rota
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const RouteChatShortcut = ({ route }: RouteChatShortcutProps) => {
  const router = useRouter();
  const messages = useRouteChatMessages(route.id);

  return (
    <RouteChatShortcutView
      route={route}
      messages={messages}
      // navigate (not push): a double tap must not stack two chats.
      onOpenChat={() =>
        router.navigate({
          pathname: "/chat",
          params: chatContextParams(chatContextOfRoute(route)),
        })
      }
    />
  );
};

export { RouteChatShortcut, RouteChatShortcutView };
