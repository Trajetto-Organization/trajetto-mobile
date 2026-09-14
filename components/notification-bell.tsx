import { Text, TouchableOpacity, View } from "react-native";

import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useUnreadNotificationsCount } from "@/features/notifications/use-notifications";

/**
 * The bell in the header: unread badge at a glance, one tap to the list.
 * Styled to sit beside the other circular header actions.
 */
const NotificationBell = () => {
  const router = useRouter();
  const unreadCount = useUnreadNotificationsCount();

  return (
    <TouchableOpacity
      // navigate (not push): a double-tap must not stack two copies of the
      // screen — navigate reuses the instance already on the stack.
      onPress={() => router.navigate("/notifications")}
      accessibilityRole="button"
      accessibilityLabel={
        unreadCount
          ? `Notificações: ${unreadCount} não lidas`
          : "Notificações"
      }
      className="rounded-full"
      style={{
        backgroundColor: "rgba(59, 130, 246, 0.2)",
        width: 40,
        height: 40,
        alignItems: "center",
        justifyContent: "center",
      }}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="notifications-outline" size={20} color="#1d4ed8" />

      {unreadCount > 0 && (
        <View
          className="absolute -right-1 -top-1 h-5 min-w-[20px] items-center
          justify-center rounded-full bg-danger-600 px-1"
        >
          <Text className="text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

export { NotificationBell };
