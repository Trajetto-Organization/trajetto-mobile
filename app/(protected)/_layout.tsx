import { View } from "react-native";
import { Stack } from "expo-router";

import { useNetworkStatus, useOutboxSync } from "@/hooks";

import { useNotificationsRealtime } from "@/features/notifications/use-notifications-realtime";
import { usePushNotifications } from "@/features/notifications/use-push-notifications";

import { useChatRealtime } from "@/features/chat/use-chat-realtime";
import { useDeliveryRealtime } from "@/features/deliveries/use-delivery-realtime";
import { useRouteRealtime } from "@/features/deliveries/use-route-realtime";

import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";
import { useRecoverDeliveryCapture } from "@/features/deliveries/hooks/use-recover-delivery-capture";
import { useRecoverPauseHandoffs } from "@/features/pauses/use-recover-pause-handoffs";
import { usePositionTracking } from "@/features/tracking/use-position-tracking";

import { useAppSurfaces } from "@/features/access/use-app-surfaces";
import { useBusinessModules } from "@/features/access/use-business-modules";
import { useCatalogRealtime } from "@/features/catalog/use-catalog-realtime";

/**
 * Everything that only exists with Entregas, mounted only for a session that
 * has it (MOB-10).
 *
 * Mounted for everyone, the chat reconciliation asked `/chat/list-messages`
 * and the deliveries list asked `/delivery/my-deliveries` on every connect
 * and every return to the foreground — a MASTER, an admin or a driver of a
 * company without Entregas collected a 403 each time. Unmounting also stops
 * everything cleanly when the module is switched off mid-shift.
 */
const DeliveriesRealtime = () => {
  useChatRealtime();

  // A stop cancelled from the panel used to vanish from the list on the next
  // sync with nothing said. Mounted here and not on the deliveries screen: the
  // driver is usually somewhere else in the app when it happens.
  useDeliveryRealtime();

  // The route itself changing: released in the morning, cancelled at noon.
  // The API has sent both to the driver's own room since routes existed and
  // nothing listened — a driver looking at the screen saw an empty list until
  // they pulled to refresh.
  useRouteRealtime();

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

  // A proof or occurrence photo the camera took while Android killed the
  // app goes back to its draft, and the driver back to that screen (MOB-12).
  // Here and not on the Entregas tab: after the kill the app lands on its
  // home, which for a fleet driver is Início, and the tab never mounted.
  useRecoverDeliveryCapture();

  // Same reason for a pause gesture the app was killed while handing over
  // to the queue (decision 6.1): it is queued now, not when the driver
  // happens to open the Entregas tab or taps the next pause.
  useRecoverPauseHandoffs();

  return null;
};

const ProtectedLayout = () => {
  // Mounted once for the whole protected area rather than per screen: the
  // submission queue has to keep running while the driver navigates, and
  // network state is not something any single screen owns.
  useNetworkStatus();
  useOutboxSync();

  useNotificationsRealtime();
  usePushNotifications();

  // A MASTER's company plan (decision 4.3); a no-op for everyone else.
  useBusinessModules();

  // Vehicles, fuel types, branches and occurrence types edited in the panel
  // reach the open pickers (decision 2.3). Both modules read catalogs, so it
  // is mounted for every session.
  useCatalogRealtime();

  const surfaces = useAppSurfaces();

  // The status banners render per screen (below each header), not here: a
  // layout-level overlay floated on top of the header buttons and blocked
  // their taps.
  //
  // Screens of a module or permission the session does not have are not
  // registered at all (decision 4.2): a deep link cannot open them, and a
  // screen that stops being allowed while open — a module switched off in the
  // panel — is closed back to the tabs.
  return (
    <View className="flex-1">
      {surfaces.deliveries ? <DeliveriesRealtime /> : null}

      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />

        <Stack.Protected guard={surfaces.selectBusiness}>
          <Stack.Screen name="select-business" />
        </Stack.Protected>

        <Stack.Protected guard={surfaces.fuel}>
          <Stack.Screen name="fuel" />
        </Stack.Protected>

        <Stack.Protected guard={surfaces.checklist}>
          <Stack.Screen name="checklist" />
        </Stack.Protected>

        <Stack.Protected guard={surfaces.deliveries}>
          <Stack.Screen name="delivery-detail" />
          <Stack.Screen name="delivery-proof" />
          <Stack.Screen name="delivery-occurrence" />
        </Stack.Protected>
      </Stack>
    </View>
  );
};

export default ProtectedLayout;
