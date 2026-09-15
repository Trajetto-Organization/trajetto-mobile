import { useEffect } from "react";

import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import type { Socket } from "socket.io-client";

import { useAuthStore } from "@/store/auth-store";
import { queryClient } from "@/providers/query-provider";

import { initializeSocket } from "@/utils/socket";

import {
  buildOverrideNotice,
  isDeliveryOverrideEvent,
} from "./delivery-override-rules";

import type { MyDeliveriesResponse } from "./types";

const DELIVERY_EVENT = "deliveryEvent";

/**
 * A stop of the driver's changing under them, live.
 *
 * Not redundant with the push the API sends through the outbox: the push
 * reaches a phone in a pocket with the app closed, this reaches a driver who
 * is looking at the list right now, in the second it happens — and it is the
 * one that can name the stop, because the row is still in the cache when the
 * event arrives.
 *
 * Order matters here. The notice is built from the CACHED delivery first and
 * the refetch is fired after: invalidating first would win the race often
 * enough to leave the toast saying "uma entrega saiu da sua lista", which is
 * useless to somebody with fourteen stops.
 */
function useDeliveryRealtime(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const businessId = useAuthStore((state) => state.user?.businessId ?? "");
  const driverId = useAuthStore((state) => state.user?.driverId ?? "");

  const router = useRouter();

  useEffect(() => {
    // Only the driver's app has a working list to lose a stop from.
    if (!isAuthenticated || !driverId || !businessId) return;

    let disposed = false;
    let boundSocket: Socket | null = null;

    const handleDeliveryEvent = (incoming: unknown) => {
      if (disposed || !isDeliveryOverrideEvent(incoming)) return;

      const key = ["my-deliveries", businessId];

      const cached = queryClient.getQueryData<MyDeliveriesResponse>(key);
      const notice = buildOverrideNotice(incoming, cached?.data ?? []);

      void queryClient.invalidateQueries({ queryKey: key });

      if (!notice) return;

      Toast.show({
        type: incoming.removedFromWorklist ? "error" : "info",
        text1: notice.title,
        text2: notice.message,
        position: "top",

        // navigate (not push): tapping twice must not stack the screen.
        onPress: () => router.navigate("/deliveries"),
      });
    };

    void initializeSocket()
      .then((socket) => {
        if (disposed) return;

        boundSocket = socket;

        socket.off(DELIVERY_EVENT, handleDeliveryEvent);
        socket.on(DELIVERY_EVENT, handleDeliveryEvent);
      })
      .catch(() => {
        // The socket provider owns connection retries. Without a socket the
        // driver still gets the push, and the pull-to-refresh still reconciles
        // the list — this hook is the fast path, not the only one.
      });

    return () => {
      disposed = true;
      boundSocket?.off(DELIVERY_EVENT, handleDeliveryEvent);
    };
  }, [isAuthenticated, businessId, driverId, router]);
}

export { useDeliveryRealtime, DELIVERY_EVENT };
