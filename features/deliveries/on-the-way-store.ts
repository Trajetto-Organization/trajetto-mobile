import AsyncStorage from "@react-native-async-storage/async-storage";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ConfirmedMark } from "./on-the-way-rules";

/**
 * The "a caminho" marks the API confirmed, per driver and company, on disk.
 *
 * `GET /delivery/my-deliveries` serves `stops[0].on_the_way_at`, but the
 * cached day only learns it on the next refetch: until then this is what
 * still knows a mark the queue let go of. Only confirmed marks live here: a
 * tap still in the queue is read from the queue, and one the API refused
 * never counts.
 */

/** A mark kept a week at most: the offline horizon, and a route's life. */
const MARK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bound per scope: a driver's week of stops, many times over. */
const MAX_MARKS_PER_SCOPE = 300;

interface StoredMark extends ConfirmedMark {
  /** When the phone stored it, for the TTL (the phone's own clock). */
  storedAt: number;
}

interface OnTheWayStoreState {
  byScope: Record<string, Record<string, StoredMark>>;

  confirm: (scope: string, stopId: string, mark: ConfirmedMark, now?: number) => void;
}

/**
 * The scope's marks without the expired ones, newest kept when over the
 * bound. Pure, exported for the test.
 */
function prunedMarks(
  marks: Record<string, StoredMark>,
  now: number,
): Record<string, StoredMark> {
  const fresh = Object.entries(marks)
    .filter(([, mark]) => now - mark.storedAt <= MARK_TTL_MS)
    .sort(([, left], [, right]) => right.storedAt - left.storedAt)
    .slice(0, MAX_MARKS_PER_SCOPE);

  return Object.fromEntries(fresh);
}

const useOnTheWayStore = create<OnTheWayStoreState>()(
  persist(
    (set) => ({
      byScope: {},

      confirm: (scope, stopId, mark, now = Date.now()) =>
        set((state) => {
          const current = state.byScope[scope] ?? {};
          const previous = current[stopId];

          // The stop keeps its latest mark, like the API's `laterOf`: a late
          // answer for an older tap must not move it back in time.
          const keep =
            previous && Date.parse(previous.at) > Date.parse(mark.at)
              ? previous
              : { ...mark, storedAt: now };

          return {
            byScope: {
              ...state.byScope,
              [scope]: prunedMarks({ ...current, [stopId]: keep }, now),
            },
          };
        }),
    }),
    {
      name: "@trajetto:on-the-way:v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ byScope: state.byScope }),

      // Hydrated on demand, never at import (the outbox imports this).
      skipHydration: true,
    },
  ),
);

let hydration: Promise<void> | null = null;

function hydrateOnTheWayStore(): Promise<void> {
  if (useOnTheWayStore.persist.hasHydrated()) return Promise.resolve();

  hydration ??= Promise.resolve(useOnTheWayStore.persist.rehydrate()).catch(
    () => undefined,
  );

  return hydration;
}

/**
 * Forgets every mark, in memory and on disk (decision 2.6: a logout clears
 * the stores; the server serves the marks again). Waits for a hydration in
 * flight: a disk read landing after the clear would bring them back.
 */
async function clearOnTheWayStore(): Promise<void> {
  await hydration;

  useOnTheWayStore.setState({ byScope: {} });

  await useOnTheWayStore.persist.clearStorage();
}

/** The scope of the marks: one driver, one company. */
const onTheWayScope = (userId: string, businessId: string): string =>
  `${userId}:${businessId}`;

export {
  MARK_TTL_MS,
  clearOnTheWayStore,
  MAX_MARKS_PER_SCOPE,
  hydrateOnTheWayStore,
  onTheWayScope,
  prunedMarks,
  useOnTheWayStore,
};
export type { StoredMark };
