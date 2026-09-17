import * as TaskManager from "expo-task-manager";
import type { LocationObject } from "expo-location";

import { logger } from "@/utils/logger";

import { ingest } from "./reporter";
import type { TrackablePing } from "./position-rules";

/**
 * Where the phone keeps reporting after the screen goes off.
 *
 * Foreground-only tracking answered the dispatcher's question — "cadê o
 * caminhão?" — for exactly as long as the driver held the app open, which is
 * not how a phone in a cradle behaves. Android suspends the JavaScript runtime
 * within seconds of the screen locking, so the trail of a ten-hour day was a
 * series of short segments around the moments somebody happened to look at
 * their phone, with the interesting stretches missing.
 *
 * A task defined here runs in its own context when the OS wakes it, including
 * after the app has been killed. It cannot see any React state, which is why
 * the buffer, the stationary filter and the flush clock live in storage — see
 * `reporter.ts`.
 *
 * **Registered but not started by default.** Background location on Android
 * needs `ACCESS_BACKGROUND_LOCATION`, a persistent notification, and a
 * declaration in the Play Console with a demo video; shipping the permission
 * without the declaration gets an app removed. So the architecture is here and
 * whether to run it is a switch the operation turns on — see
 * `docs/PENDENCIAS-DO-USUARIO.md`.
 */
const LOCATION_TASK = "trajetto-driver-location";

interface LocationTaskData {
  locations?: LocationObject[];
}

/** An expo-location fix, in the shape the API and the rules speak. */
function asPing(fix: LocationObject): TrackablePing {
  return {
    latitude: fix.coords.latitude,
    longitude: fix.coords.longitude,

    accuracy: fix.coords.accuracy ?? null,
    speed: fix.coords.speed ?? null,
    heading: fix.coords.heading ?? null,

    // No battery reading: the app carries no battery module, and adding a
    // dependency for a column nothing reads yet would be a dependency to keep.
    battery: null,

    recorded_at: new Date(fix.timestamp).toISOString(),
  };
}

/**
 * Defined at module scope, on purpose and by requirement.
 *
 * Expo looks up the task by name when the OS wakes the app, and the lookup
 * happens before any screen mounts — a task registered inside a component
 * would not exist in a headless launch, which is the only launch that matters
 * here.
 */
TaskManager.defineTask<LocationTaskData>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    // Nothing to show anybody: the app may not even be on screen. The next
    // batch tries again, and the buffer is still on disk.
    logger.warn("[Tracking] Erro na tarefa de fundo", error);
    return;
  }

  const locations = data?.locations ?? [];

  if (locations.length === 0) return;

  await ingest(locations.map(asPing));
});

export { LOCATION_TASK, asPing };
