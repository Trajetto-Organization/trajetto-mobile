import { describe, expect, it } from "vitest";

import {
  STATIONARY_KEEPALIVE_MS,
  distanceMetres,
  trackingRequestOptions,
  type TrackablePing,
} from "@/features/tracking/position-rules";

import {
  EMPTY_STATE,
  ingestInto,
  type TrackingState,
} from "@/features/tracking/state-rules";

/**
 * A truck parked at a stop keeps its dot on the tower (MOB-TRK-2).
 *
 * The stationary keepalive keeps one fix every five minutes of a parked
 * truck — on the premise that the OS keeps delivering fixes. It did not: the
 * request asked for fifteen seconds AND fifty metres, and on Android both
 * must hold. A parked truck produced one fix and then nothing, the keepalive
 * never fired, and every stop longer than ten minutes went grey on the tower
 * as "sem reportar".
 *
 * The OS is simulated with the two rules Android applies to the options the
 * app passes, as expo-location 19 implements them:
 * - `LocationRequest.setMinUpdateDistanceMeters(distanceInterval)`: a fix is
 *   delivered only this far from the last delivered one;
 * - the task consumer's deferred batching (`shouldReportDeferredLocations`):
 *   a batch is handed to the task once BOTH `deferredUpdatesInterval` has
 *   passed and `deferredUpdatesDistance` was covered.
 */

/** The tower greys a dot out after ten minutes without a point. */
const TOWER_FRESH_MS = 10 * 60 * 1000;

const START = Date.parse("2026-09-28T10:00:00.000Z");

/** A truck standing still for `minutes`, the GPS jittering a few metres. */
function parkedTruck(minutes: number, intervalMs: number): TrackablePing[] {
  const count = Math.floor((minutes * 60 * 1000) / intervalMs);

  return Array.from({ length: count + 1 }, (_, index) => ({
    latitude: -23.55 + (index % 2 === 0 ? 0.00003 : -0.00003),
    longitude: -46.63 + (index % 3 === 0 ? 0.00002 : 0),
    accuracy: 12,
    recorded_at: new Date(START + index * intervalMs).toISOString(),
  }));
}

const at = (ping: TrackablePing) => Date.parse(ping.recorded_at);

function deliveredByTheOs(
  fixes: TrackablePing[],
  distanceInterval: number,
): TrackablePing[] {
  const delivered: TrackablePing[] = [];

  for (const fix of fixes) {
    const last = delivered[delivered.length - 1];

    if (!last || distanceMetres(last, fix) >= distanceInterval) {
      delivered.push(fix);
    }
  }

  return delivered;
}

function batchesForTheTask(
  delivered: TrackablePing[],
  deferredUpdatesInterval: number,
  deferredUpdatesDistance: number,
): TrackablePing[][] {
  const batches: TrackablePing[][] = [];

  let pending: TrackablePing[] = [];
  let lastReported: TrackablePing | null = null;
  let covered = 0;

  for (const fix of delivered) {
    const previous = pending[pending.length - 1] ?? lastReported;

    if (previous) covered += distanceMetres(previous, fix);

    pending.push(fix);

    const oldest = lastReported ?? pending[0];

    if (
      at(fix) - at(oldest) >= deferredUpdatesInterval &&
      covered >= deferredUpdatesDistance
    ) {
      batches.push(pending);

      lastReported = fix;
      pending = [];
      covered = 0;
    }
  }

  return batches;
}

/** The points the phone keeps (and sends) from what the OS handed over. */
function keptFrom(batches: TrackablePing[][]): TrackablePing[] {
  let state: TrackingState = { ...EMPTY_STATE, ownerId: "driver-a" };

  for (const batch of batches) {
    state = ingestInto(state, batch).state;
  }

  return state.buffer;
}

function longestGap(kept: TrackablePing[], until: number): number {
  const times = [...kept.map(at), until];

  let longest = times[0] - START;

  for (let index = 1; index < times.length; index += 1) {
    longest = Math.max(longest, times[index] - times[index - 1]);
  }

  return longest;
}

describe("a truck parked at a stop for twenty minutes", () => {
  const options = trackingRequestOptions();
  const fixes = parkedTruck(20, options.timeInterval);
  const end = START + 20 * 60 * 1000;

  it("never goes ten minutes without a point, app in the foreground", () => {
    const delivered = deliveredByTheOs(fixes, options.distanceInterval);
    const kept = keptFrom(delivered.map((fix) => [fix]));

    expect(kept.length).toBeGreaterThanOrEqual(4);
    expect(longestGap(kept, end)).toBeLessThan(TOWER_FRESH_MS);
  });

  it("never goes ten minutes without a point, from the background task", () => {
    const delivered = deliveredByTheOs(fixes, options.distanceInterval);
    const batches = batchesForTheTask(
      delivered,
      options.deferredUpdatesInterval,
      options.deferredUpdatesDistance,
    );
    const kept = keptFrom(batches);

    expect(kept.length).toBeGreaterThanOrEqual(4);
    expect(longestGap(kept, end)).toBeLessThan(TOWER_FRESH_MS);
  });

  it("still drops the jitter: one point per keepalive, not one per fix", () => {
    const kept = keptFrom(
      deliveredByTheOs(fixes, options.distanceInterval).map((fix) => [fix]),
    );

    // 81 fixes in twenty minutes; the keepalive keeps one every five.
    expect(kept.length).toBeLessThanOrEqual(
      Math.ceil((20 * 60 * 1000) / STATIONARY_KEEPALIVE_MS) + 1,
    );
  });

  it("does not wake the background task for every fix", () => {
    // Batched: a parked truck must not wake the JS runtime every 15 s.
    expect(options.deferredUpdatesInterval).toBeGreaterThan(options.timeInterval);
    expect(options.deferredUpdatesInterval).toBeLessThan(STATIONARY_KEEPALIVE_MS);
  });
});
