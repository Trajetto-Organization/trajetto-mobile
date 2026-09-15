import { describe, expect, it } from "vitest";

import {
  FLUSH_AT_COUNT,
  FLUSH_INTERVAL_MS,
  MAX_BUFFERED,
  STATIONARY_KEEPALIVE_MS,
  STATIONARY_METRES,
  appendPing,
  distanceMetres,
  shouldFlush,
  shouldKeepPing,
  shouldTrack,
  type TrackablePing,
} from "@/features/tracking/position-rules";

const AT = new Date("2026-09-17T12:00:00.000Z");

function ping(overrides: Partial<TrackablePing> = {}): TrackablePing {
  return {
    latitude: -23.55,
    longitude: -46.63,
    accuracy: 10,
    recorded_at: AT.toISOString(),
    ...overrides,
  };
}

function withRoute(status: string) {
  return { stops: [{ route: { status } }] };
}

/**
 * A driver is not a package.
 *
 * Every rule here is about a phone in somebody's pocket: whose battery it
 * spends, and how much of somebody's day it reports. The one that matters most
 * is the first — the app follows a driver only while a route of theirs is
 * actually running, and "logged in" is not the same thing.
 */
describe("when the app follows a driver at all", () => {
  it("tracks while a route is in progress", () => {
    expect(shouldTrack([withRoute("IN_PROGRESS")])).toBe(true);
  });

  it("does not track a route that has not left", () => {
    // A released route is a load still in the yard. Following it would report
    // where somebody parks overnight.
    expect(shouldTrack([withRoute("RELEASED")])).toBe(false);
    expect(shouldTrack([withRoute("PLANNED")])).toBe(false);
  });

  it("does not track a route that is over", () => {
    // Which is a driver on their way home.
    expect(shouldTrack([withRoute("COMPLETED")])).toBe(false);
    expect(shouldTrack([withRoute("CANCELLED")])).toBe(false);
  });

  it("does not track deliveries that are on no route", () => {
    expect(shouldTrack([{ stops: [] }, { stops: null }, {}])).toBe(false);
  });

  it("tracks when any one of the day's routes is running", () => {
    expect(
      shouldTrack([withRoute("COMPLETED"), withRoute("IN_PROGRESS")]),
    ).toBe(true);
  });

  it("does not track an empty day", () => {
    expect(shouldTrack([])).toBe(false);
  });
});

describe("which fixes are worth keeping", () => {
  it("keeps the first one, always", () => {
    expect(shouldKeepPing(null, ping())).toBe(true);
  });

  it("drops a parked truck's jitter", () => {
    // A stopped phone still produces a fix every fifteen seconds, each a few
    // metres from the last. Keeping them is 240 rows an hour drawing a dot on
    // top of a dot.
    const previous = ping();

    const jitter = ping({
      latitude: -23.5501,
      recorded_at: new Date(AT.getTime() + 15_000).toISOString(),
    });

    expect(distanceMetres(previous, jitter)).toBeLessThan(STATIONARY_METRES);
    expect(shouldKeepPing(previous, jitter)).toBe(false);
  });

  it("keeps a fix that actually moved", () => {
    const previous = ping();

    const moved = ping({
      latitude: -23.5545,
      recorded_at: new Date(AT.getTime() + 15_000).toISOString(),
    });

    expect(distanceMetres(previous, moved)).toBeGreaterThan(STATIONARY_METRES);
    expect(shouldKeepPing(previous, moved)).toBe(true);
  });

  it("keeps a fix from a truck that has been standing a long time", () => {
    // Otherwise a driver who spends twenty minutes at an address vanishes from
    // the map, and a trail that simply stopped is indistinguishable from a
    // phone that died.
    const previous = ping();

    const waiting = ping({
      recorded_at: new Date(
        AT.getTime() + STATIONARY_KEEPALIVE_MS,
      ).toISOString(),
    });

    expect(shouldKeepPing(previous, waiting)).toBe(true);
  });
});

describe("measuring the ground between two fixes", () => {
  it("answers zero for the same place", () => {
    expect(distanceMetres(ping(), ping())).toBe(0);
  });

  it("is close enough over a city block", () => {
    // A hundredth of a degree of latitude is about 1.111 km, everywhere.
    const metres = distanceMetres(
      { latitude: -23.55, longitude: -46.63 },
      { latitude: -23.56, longitude: -46.63 },
    );

    expect(metres).toBeGreaterThan(1050);
    expect(metres).toBeLessThan(1150);
  });

  it("does not care which way round the two points are given", () => {
    const a = { latitude: -23.55, longitude: -46.63 };
    const b = { latitude: -23.5545, longitude: -46.6312 };

    expect(distanceMetres(a, b)).toBeCloseTo(distanceMetres(b, a), 6);
  });
});

describe("when the phone sends what it has", () => {
  it("never sends an empty buffer", () => {
    expect(shouldFlush({ buffered: 0, lastFlushAt: null })).toBe(false);
  });

  it("sends the first point without waiting out an interval", () => {
    // The tower showing a truck two minutes after it left would have somebody
    // calling the driver to ask whether the app is working.
    expect(shouldFlush({ buffered: 1, lastFlushAt: null })).toBe(true);
  });

  it("waits out the interval after that", () => {
    const lastFlushAt = AT.getTime();

    expect(
      shouldFlush({ buffered: 1, lastFlushAt, now: lastFlushAt + 1000 }),
    ).toBe(false);

    expect(
      shouldFlush({
        buffered: 1,
        lastFlushAt,
        now: lastFlushAt + FLUSH_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it("does not wait when enough has piled up", () => {
    // One request per fix would be four a minute per driver; three hundred
    // drivers is twenty requests a second of pure bookkeeping, each one waking
    // a radio that was about to sleep.
    const lastFlushAt = AT.getTime();

    expect(
      shouldFlush({
        buffered: FLUSH_AT_COUNT,
        lastFlushAt,
        now: lastFlushAt + 1000,
      }),
    ).toBe(true);
  });
});

describe("a phone that has been out of signal", () => {
  it("keeps piling up until the cap", () => {
    let buffer: TrackablePing[] = [];

    for (let index = 0; index < MAX_BUFFERED; index += 1) {
      buffer = appendPing(buffer, ping({ latitude: -23.55 + index * 0.001 }));
    }

    expect(buffer).toHaveLength(MAX_BUFFERED);
  });

  it("forgets the oldest, never the newest", () => {
    let buffer: TrackablePing[] = [];

    for (let index = 0; index < MAX_BUFFERED + 10; index += 1) {
      buffer = appendPing(buffer, ping({ latitude: index }));
    }

    expect(buffer).toHaveLength(MAX_BUFFERED);

    // The recent points are what a dispatcher is looking at a map for, and a
    // trail with a gap in the middle beats no trail at all.
    expect(buffer[buffer.length - 1].latitude).toBe(MAX_BUFFERED + 9);
    expect(buffer[0].latitude).toBe(10);
  });
});
