import { useEffect, useRef } from "react";

import * as Location from "expo-location";

import { apiClient } from "@/utils/api";
import { logger } from "@/utils/logger";

import { asyncStorage } from "@/utils/storage";

import {
  PING_DISTANCE_METRES,
  PING_INTERVAL_MS,
  appendPing,
  shouldFlush,
  shouldKeepPing,
  shouldTrack,
  type RouteBearingDelivery,
  type TrackablePing,
} from "./position-rules";

/**
 * Where the buffer lives while the app is closed.
 *
 * A driver crosses a dead zone, the OS kills the app to reclaim memory, and
 * the points collected since the last flush would be gone. They are the ones
 * covering the stretch somebody will ask about, so they are written down.
 */
const BUFFER_KEY = "driver_position_buffer";

interface RecordResponse {
  data: { stored: number; rejected: number; tracking: boolean };
}

/**
 * The phone reporting where it is, while a route of the driver's runs.
 *
 * Foreground only, deliberately. Background location on Android needs a
 * persistent notification and a separate Play Store review, and on iOS it is
 * the permission users refuse most — a v1 that follows the truck while the
 * driver has the app open answers the dispatcher's question ("cadê o
 * caminhão?") without asking anybody to grant always-on tracking. The
 * background upgrade is a decision for the operation to make, not one to slip
 * in.
 *
 * The API has the last word on whether to keep going: it answers
 * `tracking: false` when no route of theirs is in progress, and this stops.
 * That matters because the phone's own view of the day can be stale — the
 * dispatcher may have cancelled the route while the driver was out of signal.
 */
function usePositionTracking(deliveries: RouteBearingDelivery[]): void {
  const buffer = useRef<TrackablePing[]>([]);
  const lastKept = useRef<TrackablePing | null>(null);

  const lastFlushAt = useRef<number | null>(null);
  const flushing = useRef<boolean>(false);

  /** Set when the API says to stop, so a stale list cannot restart it. */
  const stopped = useRef<boolean>(false);

  const wanted = shouldTrack(deliveries);

  useEffect(() => {
    if (!wanted || stopped.current) return;

    let disposed = false;
    let subscription: Location.LocationSubscription | null = null;

    const flush = async () => {
      if (flushing.current || buffer.current.length === 0) return;

      flushing.current = true;

      // Taken before the await. Points arriving mid-request belong to the next
      // batch — counted here they would be sent twice, dropped here they would
      // be lost.
      const sending = buffer.current;

      buffer.current = [];

      try {
        const response = await apiClient.post<RecordResponse>(
          "/route/positions",
          { pings: sending },
        );

        lastFlushAt.current = Date.now();

        await asyncStorage.removeItem(BUFFER_KEY);

        if (!response.data.tracking) {
          stopped.current = true;

          subscription?.remove();
          subscription = null;
        }
      } catch (error) {
        // Put them back at the FRONT: they are older than whatever arrived
        // while the request was in flight, and a trail is only readable in
        // order.
        buffer.current = [...sending, ...buffer.current];

        await asyncStorage.setItem(BUFFER_KEY, buffer.current);

        logger.warn("[Tracking] Falha ao enviar posições", error);
      } finally {
        flushing.current = false;
      }
    };

    const start = async () => {
      // Whatever survived a kill. Restored before the first new fix so the
      // order stays right.
      const saved = await asyncStorage.getItem<TrackablePing[]>(BUFFER_KEY);

      if (saved?.length) buffer.current = saved;

      const { status } = await Location.requestForegroundPermissionsAsync();

      if (disposed) return;

      if (status !== Location.PermissionStatus.GRANTED) {
        // Not an error the driver is shown. They refused, or the phone is
        // locked down by an MDM; either way the app still works and the map
        // simply has no dot for them.
        logger.info("[Tracking] Permissão de localização não concedida");
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: PING_INTERVAL_MS,
          distanceInterval: PING_DISTANCE_METRES,
        },
        (position) => {
          if (disposed || stopped.current) return;

          const ping: TrackablePing = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,

            accuracy: position.coords.accuracy ?? null,
            speed: position.coords.speed ?? null,
            heading: position.coords.heading ?? null,

            // No battery reading: the app carries no battery module, and
            // adding a dependency for a column nothing reads yet would be a
            // dependency to keep. The API takes null.
            battery: null,

            recorded_at: new Date(position.timestamp).toISOString(),
          };

          // A parked truck still produces a fix every fifteen seconds. Dropped
          // here, before it costs a row or a request.
          if (!shouldKeepPing(lastKept.current, ping)) return;

          lastKept.current = ping;
          buffer.current = appendPing(buffer.current, ping);

          void asyncStorage.setItem(BUFFER_KEY, buffer.current);

          if (
            shouldFlush({
              buffered: buffer.current.length,
              lastFlushAt: lastFlushAt.current,
            })
          ) {
            void flush();
          }
        },
      );
    };

    void start();

    return () => {
      disposed = true;

      subscription?.remove();

      // One last attempt on the way out — the driver closing the app at the
      // end of the day is exactly when the last stretch would otherwise sit
      // in the buffer until tomorrow.
      void flush();
    };
  }, [wanted]);

  // The route ended while the app was open: stop, and send what is left.
  useEffect(() => {
    if (wanted) return;

    stopped.current = false;

    if (buffer.current.length === 0) return;

    void apiClient
      .post<RecordResponse>("/route/positions", { pings: buffer.current })
      .then(() => {
        buffer.current = [];

        return asyncStorage.removeItem(BUFFER_KEY);
      })
      .catch((error) => {
        logger.warn("[Tracking] Falha ao enviar o último lote", error);
      });
  }, [wanted]);
}

export { BUFFER_KEY, usePositionTracking };
