import { View } from "react-native";
import { Stack } from "expo-router";

import { useNetworkStatus, useOutboxSync } from "@/hooks";

import { useNotificationsRealtime } from "@/features/notifications/use-notifications-realtime";
import { usePushNotifications } from "@/features/notifications/use-push-notifications";

import { useChatRealtime } from "@/features/chat/use-chat-realtime";

const ProtectedLayout = () => {
  // Mounted once for the whole protected area rather than per screen: the
  // submission queue has to keep running while the driver navigates, and
  // network state is not something any single screen owns.
  useNetworkStatus();
  useOutboxSync();

  useNotificationsRealtime();
  usePushNotifications();

  useChatRealtime();

  // The status banners render per screen (below each header), not here: a
  // layout-level overlay floated on top of the header buttons and blocked
  // their taps.
  return (
    <View className="flex-1">
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
};

export default ProtectedLayout;
