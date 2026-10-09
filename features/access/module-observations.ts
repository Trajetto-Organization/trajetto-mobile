import type { ModuleObservation } from "@/features/submissions/outbox-rules";

import { APP_MODULES } from "./module-rules";

/**
 * What the server last said about each module, per company.
 *
 * The session publishes here whenever it learns a plan — the `/user/me` of a
 * company user, the plan endpoint a MASTER reads, the re-read that follows
 * `entitlementsChanged` — and the offline queue listens: it is the only thing
 * that sends a parked submission again on its own (MOB-03).
 *
 * Its own module, with no imports of the session or the queue, so that
 * neither has to load the other (the queue brings the filesystem with it).
 * In memory on purpose: it is evidence about "now", and a cold start asks
 * the server again before anything is sent.
 */

const observations = new Map<string, ModuleObservation>();
const listeners = new Set<() => Promise<void> | void>();

const observationKey = (businessId: string, module: string): string =>
  `${businessId}:${module}`;

/**
 * Records a company's plan as the server just stated it, and wakes the
 * listeners when that says something new. Resolves once they are done.
 *
 * Older words than the ones already held are ignored: the newest statement
 * about a module is the only one that counts.
 */
async function observeEnabledModules(observation: {
  businessId: string | null | undefined;
  enabledModules: readonly string[];
  observedAt?: number;
}): Promise<void> {
  const { businessId, enabledModules } = observation;
  if (!businessId) return;

  const observedAt = observation.observedAt ?? Date.now();
  let isNews = false;

  for (const module of APP_MODULES) {
    const key = observationKey(businessId, module);
    const current = observations.get(key);

    if (current && current.observedAt >= observedAt) continue;

    observations.set(key, {
      enabled: enabledModules.includes(module),
      observedAt,
    });
    isNews = true;
  }

  if (!isNews) return;

  await Promise.allSettled([...listeners].map((listener) => listener()));
}

function moduleObservation(
  businessId: string,
  module: string,
): ModuleObservation | null {
  return observations.get(observationKey(businessId, module)) ?? null;
}

/** Runs `listener` after every new word. Returns the unsubscribe. */
function onModulesObserved(listener: () => Promise<void> | void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** What the server told one session is not evidence for the next one. */
function forgetModuleObservations(): void {
  observations.clear();
}

export {
  forgetModuleObservations,
  moduleObservation,
  observeEnabledModules,
  onModulesObserved,
};
