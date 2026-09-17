import { useEffect, useRef } from "react";

import Constants from "expo-constants";
import * as Location from "expo-location";

import { logger } from "@/utils/logger";
import { asyncStorage } from "@/utils/storage";

import {
  PING_DISTANCE_METRES,
  PING_INTERVAL_MS,
  type RouteBearingDelivery,
  type TrackablePing,
} from "./position-rules";

import { shouldRequestBackground, trackingMode } from "./mode-rules";
import { LOCATION_TASK, asPing } from "./background-task";

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
  const wanted = deliveries.some((delivery) =>
    (delivery.stops ?? []).some((stop) => stop.route.status === "IN_PROGRESS"),
  );

  /** Kept so the cleanup can stop whatever this run actually started. */
  const started = useRef<"background" | "foreground" | null>(null);

  const backgroundBuild = Boolean(
    (Constants.expoConfig?.extra as { backgroundTracking?: boolean } | undefined)
      ?.backgroundTracking,
  );

  useEffect(() => {
    let disposed = false;
    let subscription: Location.LocationSubscription | null = null;

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

      if (!foregroundGranted) {
        // Not an error the driver is shown. They refused, or the phone is
        // locked down by an MDM; either way the app still works and the map
        // simply has no dot for them.
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

      if (mode === "background") {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: PING_INTERVAL_MS,
          distanceInterval: PING_DISTANCE_METRES,

          // Batched by the OS while the screen is off. Waking the process for
          // every fix is what turns background tracking into the reason a
          // driver uninstalls the app.
          deferredUpdatesInterval: PING_INTERVAL_MS,
          deferredUpdatesDistance: PING_DISTANCE_METRES,

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
          timeInterval: PING_INTERVAL_MS,
          distanceInterval: PING_DISTANCE_METRES,
        },
        (position) => {
          if (disposed) return;

          void ingest([asPing(position)] as TrackablePing[]);
        },
      );

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
  }, [wanted, backgroundBuild]);
}

export { ASKED_KEY, usePositionTracking };
