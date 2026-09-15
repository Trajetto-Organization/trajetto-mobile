import { View } from "react-native";
import { Stack } from "expo-router";

import { useNetworkStatus, useOutboxSync } from "@/hooks";

import { useNotificationsRealtime } from "@/features/notifications/use-notifications-realtime";
import { usePushNotifications } from "@/features/notifications/use-push-notifications";

import { useChatRealtime } from "@/features/chat/use-chat-realtime";
import { useDeliveryRealtime } from "@/features/deliveries/use-delivery-realtime";

import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";
import { usePositionTracking } from "@/features/tracking/use-position-tracking";

const ProtectedLayout = () => {
  // Mounted once for the whole protected area rather than per screen: the
  // submission queue has to keep running while the driver navigates, and
  // network state is not something any single screen owns.
  useNetworkStatus();
  useOutboxSync();

  useNotificationsRealtime();
  usePushNotifications();

  useChatRealtime();

  // A stop cancelled from the panel used to vanish from the list on the next
  // sync with nothing said. Mounted here and not on the deliveries screen: the
  // driver is usually somewhere else in the app when it happens.
  useDeliveryRealtime();

  // Where the truck is, while a route of theirs is running — and only then.
  // Mounted here rather than on the deliveries screen because a driver spends
  // the day on the stop screen, on the camera, and in the chat; tracking that
  // stopped whenever they navigated would be a map with holes in it.
  //
  // The list it reads is the same query the screens use, so this adds no
  // request of its own: it is already in the cache, and offline it is the last
  // synced day.
  const { deliveries } = useMyDeliveries();

  usePositionTracking(deliveries);

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
