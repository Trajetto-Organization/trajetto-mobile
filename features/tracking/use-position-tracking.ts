import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import Constants from "expo-constants";
import * as Location from "expo-location";

import { logger } from "@/utils/logger";
import { asyncStorage } from "@/utils/storage";

import {
  shouldTrack,
  trackingRequestOptions,
  type RouteBearingDelivery,
  type TrackablePing,
} from "./position-rules";

import { shouldRequestBackground, trackingMode } from "./mode-rules";
import { LOCATION_TASK, asPing } from "./background-task";
import { locationAccessOf } from "./location-access-rules";
import { useTrackingStatus } from "./tracking-status";

import { flush, ingest, isStopped, resume } from "./reporter";

/** Remembered so a driver who said no is not asked on every route. */
const ASKED_KEY = "driver_background_location_asked";

/**
 * The phone reporting where it is, while a route of the driver's runs.
 *
 * Two modes, and which one is used is not a preference:
 *
 * - **background**, when the build carries `ACCESS_BACKGROUND_LOCATION` and
 *   the driver granted "all the time". A foreground service keeps reporting
 *   with the screen off, which is how a phone in a cradle actually spends the
 *   day. Android shows a persistent notification the whole time — that is the
 *   deal, and it is the honest one: the driver can see they are being
 *   followed.
 * - **foreground**, otherwise. What this app did before, and still the right
 *   fallback: a driver who refused "all the time", or a build without the
 *   Play Console declaration, still puts a dot on the tower while they have
 *   the app open.
 *
 * The API has the last word on whether to keep going: it answers
 * `tracking: false` when no route of theirs is in progress, and everything
 * stops. That matters because the phone's own view of the day can be stale —
 * the dispatcher may have cancelled the route while the driver was out of
 * signal.
 */
function usePositionTracking(deliveries: RouteBearingDelivery[]): void {
  const wanted = shouldTrack(deliveries);

  /** Kept so the cleanup can stop whatever this run actually started. */
  const started = useRef<"background" | "foreground" | null>(null);

  const retryToken = useTrackingStatus((state) => state.retryToken);

  const backgroundBuild = Boolean(
    (Constants.expoConfig?.extra as { backgroundTracking?: boolean } | undefined)
      ?.backgroundTracking,
  );

  useEffect(() => {
    let disposed = false;
    let subscription: Location.LocationSubscription | null = null;

    const { report } = useTrackingStatus.getState();

    report({ wanted });

    const stopBackground = async () => {
      try {
        const running = await Location.hasStartedLocationUpdatesAsync(
          LOCATION_TASK,
        );

        if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      } catch (error) {
        logger.warn("[Tracking] Falha ao parar a tarefa de fundo", error);
      }
    };

    const start = async () => {
      if (!wanted) {
        // A route that ended: send the tail and let the flag lift for the next
        // one. Doing it here rather than in a second effect keeps one place
        // deciding what "not tracking" means.
        await stopBackground();
        await flush();

        return;
      }

      // A new route is a new day as far as the stop flag is concerned.
      await resume();

      const foreground = await Location.requestForegroundPermissionsAsync();

      if (disposed) return;

      const foregroundGranted =
        foreground.status === Location.PermissionStatus.GRANTED;

      // The app still works without it, but the driver is told: the route
      // runs and the central does not see them (MOB-TRK-5).
      report({ access: locationAccessOf(foreground) });

      if (!foregroundGranted) {
        logger.info("[Tracking] Permissão de localização não concedida");
        return;
      }

      let backgroundGranted = false;

      if (backgroundBuild) {
        const current = await Location.getBackgroundPermissionsAsync();

        backgroundGranted =
          current.status === Location.PermissionStatus.GRANTED;

        const alreadyAsked = Boolean(
          await asyncStorage.getItem<boolean>(ASKED_KEY),
        );

        if (
          shouldRequestBackground({
            wanted,
            backgroundBuild,
            foregroundGranted,
            backgroundGranted,
            alreadyAsked,
          })
        ) {
          await asyncStorage.setItem(ASKED_KEY, true);

          const asked = await Location.requestBackgroundPermissionsAsync();

          backgroundGranted =
            asked.status === Location.PermissionStatus.GRANTED;
        }
      }

      if (disposed) return;

      const mode = trackingMode({
        wanted,
        stopped: await isStopped(),
        foregroundGranted,
        backgroundGranted,
        backgroundBuild,
      });

      if (disposed || mode === "off") return;

      // One set of options for both modes: every fifteen seconds whether the
      // truck moves or not, so a parked truck still keeps its dot (MOB-TRK-2).
      const request = trackingRequestOptions();

      if (mode === "background") {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: request.timeInterval,
          distanceInterval: request.distanceInterval,

          // Batched by the OS while the screen is off. Waking the process for
          // every fix is what turns background tracking into the reason a
          // driver uninstalls the app.
          deferredUpdatesInterval: request.deferredUpdatesInterval,
          deferredUpdatesDistance: request.deferredUpdatesDistance,

          pausesUpdatesAutomatically: false,

          foregroundService: {
            notificationTitle: "Rota em andamento",
            notificationBody:
              "A central acompanha sua rota enquanto ela está em andamento.",
            notificationColor: "#2563eb",
          },
        });

        started.current = "background";

        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: request.timeInterval,
          distanceInterval: request.distanceInterval,
        },
        (position) => {
          if (disposed) return;

          void ingest([asPing(position)] as TrackablePing[]).then(({ halt }) => {
            // The API ended it — route over, or the phone refused (a module
            // switched off): the GPS goes off now, not at the next list sync.
            if (halt) {
              subscription?.remove();
              subscription = null;
            }
          });
        },
      );

      if (disposed) {
        subscription.remove();
        subscription = null;
        return;
      }

      started.current = "foreground";
    };

    void start();

    return () => {
      disposed = true;

      subscription?.remove();

      if (started.current === "background") void stopBackground();

      started.current = null;

      // One last attempt on the way out — the driver closing the app at the
      // end of the day is exactly when the last stretch would otherwise sit in
      // the buffer until tomorrow.
      void flush();
    };
  }, [wanted, backgroundBuild, retryToken]);

  // Coming back from the system settings with the permission switched on
  // restarts tracking without waiting for the next route.
  useEffect(() => {
    if (!wanted) return;

    const subscription = AppState.addEventListener("change", (next) => {
      // Leaving the app: in foreground mode the fixes stop with it, and the
      // points still buffered would reach the tower only when the driver
      // came back (MOB-TRK-1). Sent now, while the process still runs.
      if (next === "background") {
        void flush().catch(() => undefined);
        return;
      }

      if (next !== "active") return;

      const { access, retry } = useTrackingStatus.getState();

      if (access !== "denied" && access !== "blocked") return;

      void Location.getForegroundPermissionsAsync()
        .then((permission) => {
          if (permission.status === Location.PermissionStatus.GRANTED) retry();
        })
        .catch(() => undefined);
    });

    return () => subscription.remove();
  }, [wanted]);

  // Nothing to warn about once this session stops tracking altogether.
  useEffect(() => () => useTrackingStatus.getState().reset(), []);
}

export { ASKED_KEY, usePositionTracking };
