import { useEffect } from "react";

import Toast from "react-native-toast-message";
import type { Socket } from "socket.io-client";

import { useAuthStore } from "@/store/auth-store";
import { queryClient } from "@/providers/query-provider";

import { initializeSocket, onRealtimeResync } from "@/utils/socket";

import { announcePlanChange } from "./plan-change-notice";

const ROUTE_EVENT = "routeEvent";

/**
 * The driver's route changing under them, live.
 *
 * The API has sent this to the driver's own room since routes existed —
 * released, cancelled — and nothing in the app listened: a search for the
 * event name across both clients found the emitter and no consumer at all. So
 * a dispatcher releasing the day's route at seven in the morning reached a
 * phone only through the push, and a driver already looking at the screen saw
 * an empty list until they pulled to refresh.
 *
 * It does not patch anything from the payload. The event carries a route id
 * and a status, not the stops or the addresses, so the list is invalidated and
 * refetched — the same path pull-to-refresh takes, minus the pulling.
 */
function useRouteRealtime(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const businessId = useAuthStore((state) => state.user?.businessId ?? "");
  const driverId = useAuthStore((state) => state.user?.driverId ?? "");

  useEffect(() => {
    // Only a driver has a route of their own to be told about.
    if (!isAuthenticated || !driverId || !businessId) return;

    let disposed = false;
    let boundSocket: Socket | null = null;

    const handleRouteEvent = (incoming: unknown) => {
      if (disposed) return;

      const event = incoming as {
        type?: string;
        routeId?: string;
        routeCode?: number;
        planVersion?: number;
      } | null;

      if (!event?.type) return;

      void queryClient.invalidateQueries({
        queryKey: ["my-deliveries", businessId],
      });

      /**
       * Only the ones the driver has to know about, and only as a toast.
       *
       * A released route is work arriving; a cancelled one is work leaving;
       * a changed one is the day's plan moving under them,
       * and a driver who is not told keeps driving to an address nobody
       * expects them at any more. The rest — started, completed, a stop
       * settling — are things this phone just DID, and telling somebody what
       * they did a second ago is noise.
       */
      if (event.type === "route.released") {
        Toast.show({
          type: "info",
          text1: "Nova rota liberada",
          text2: event.routeCode
            ? `A rota ${event.routeCode} está disponível.`
            : "Sua rota do dia está disponível.",
          position: "top",
        });

        return;
      }

      // A released route's stops or order changed under the driver (route
      // design §6.3). Shared with the sync's notice, so the refetch above does
      // not say it again.
      if (event.type === "route.stops_changed") {
        announcePlanChange({
          routeId: event.routeId ?? "",
          code: event.routeCode,
          planVersion: event.routeId ? event.planVersion : undefined,
        });

        return;
      }

      if (event.type === "route.cancelled") {
        Toast.show({
          type: "error",
          text1: "Rota cancelada",
          text2: event.routeCode
            ? `A rota ${event.routeCode} foi cancelada pelo despachante.`
            : "Sua rota foi cancelada pelo despachante.",
          position: "top",
          visibilityTime: 6000,
        });
      }
    };

    void initializeSocket()
      .then((socket) => {
        if (disposed) return;

        boundSocket = socket;

        // Removed before adding: a remount must not leave two handlers, which
        // would refetch twice and show the toast twice.
        socket.off(ROUTE_EVENT, handleRouteEvent);
        socket.on(ROUTE_EVENT, handleRouteEvent);
      })
      .catch(() => {
        // The socket provider owns connection retries. Without one the driver
        // still gets the push and pull-to-refresh still reconciles — this is
        // the fast path, not the only one.
      });

    /*
      The route and delivery events emitted while the socket was down are
      gone — the API has no replay — so a reconnection refetches the same list
      both events invalidate. No toast: nothing is known about what changed,
      only that something may have. `useDeliveryRealtime` shares the key, so
      this one subscription covers both.
    */
    const stopResync = onRealtimeResync(() => {
      if (disposed) return;

      void queryClient.invalidateQueries({
        queryKey: ["my-deliveries", businessId],
      });
    });

    return () => {
      disposed = true;
      stopResync();
      boundSocket?.off(ROUTE_EVENT, handleRouteEvent);
    };
  }, [isAuthenticated, businessId, driverId]);
}

export { useRouteRealtime, ROUTE_EVENT };
