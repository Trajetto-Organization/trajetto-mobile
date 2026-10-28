import { describe, expect, it } from "vitest";

import {
  shouldRequestBackground,
  trackingMode,
} from "@/features/tracking/mode-rules";

import {
  EMPTY_STATE,
  afterFlushAttempt,
  afterFlushSuccess,
  capBuffer,
  ingestInto,
  restoreFrom,
} from "@/features/tracking/state-rules";

import {
  MAX_BUFFERED,
  STATIONARY_KEEPALIVE_MS,
  type TrackablePing,
} from "@/features/tracking/position-rules";

/**
 * Following a truck after the screen goes off.
 *
 * Tracking was foreground-only, and the comment explaining why was honest
 * about the trade — background location on Android needs a persistent
 * notification and a Play Store declaration, and on iOS it is the permission
 * users refuse most. What it did not say is what that costs the product it
 * belongs to: a control tower whose dots freeze whenever a driver's screen
 * locks answers "cadê o caminhão?" with the position the phone had the last
 * time somebody happened to look at it. A phone in a cradle spends the day
 * locked; Android suspends the JavaScript runtime seconds after that. So the
 * trail of a ten-hour day came out as a handful of short segments with the
 * interesting stretches missing.
 *
 * The architecture is here and the switch is off: the manifest permission is
 * added only by a build that declares it, because Google reviews the manifest
 * and an undeclared `ACCESS_BACKGROUND_LOCATION` gets an app removed.
 *
 * What is tested is what decides. The task itself is three lines around
 * `ingest`; the OS wiring is not something a test can honestly assert from
 * Node, and pretending otherwise with a pile of native mocks would be a test
 * of the mocks.
 */
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

/** Far enough to pass the stationary filter every time. */
function movedPing(index: number): TrackablePing {
  return ping({
    latitude: -23.55 + index * 0.01,
    recorded_at: new Date(AT.getTime() + index * 15_000).toISOString(),
  });
}

describe("which way the phone follows the truck", () => {
  const granted = { wanted: true, foregroundGranted: true };

  it("does not follow at all without a route in progress", () => {
    expect(
      trackingMode({
        ...granted,
        wanted: false,
        backgroundGranted: true,
        backgroundBuild: true,
      }),
    ).toBe("off");
  });

  it("nor after the API says the route ended", () => {
    /**
     * The phone's own view of the day can be stale — the dispatcher may have
     * cancelled the route while the driver was out of signal — so the API's
     * `tracking: false` outranks the delivery list the app is holding.
     */
    expect(
      trackingMode({
        ...granted,
        stopped: true,
        backgroundGranted: true,
        backgroundBuild: true,
      }),
    ).toBe("off");
  });

  it("nor without the basic permission", () => {
    expect(
      trackingMode({
        ...granted,
        foregroundGranted: false,
        backgroundGranted: true,
        backgroundBuild: true,
      }),
    ).toBe("off");
  });

  it("follows in the background when the build and the driver both allow it", () => {
    expect(
      trackingMode({
        ...granted,
        backgroundGranted: true,
        backgroundBuild: true,
      }),
    ).toBe("background");
  });

  it("falls back to the foreground when the driver refused all-the-time", () => {
    // Less than was asked for, and better than nothing: the dot still moves
    // while they have the app open.
    expect(
      trackingMode({
        ...granted,
        backgroundGranted: false,
        backgroundBuild: true,
      }),
    ).toBe("foreground");
  });

  it("and never uses the background in a build that did not declare it", () => {
    /**
     * The one that is not a preference. Android grants only what the manifest
     * declares; a build without the declaration asking for it gets refused by
     * the OS and logged as a policy violation.
     */
    expect(
      trackingMode({
        ...granted,
        backgroundGranted: true,
        backgroundBuild: false,
      }),
    ).toBe("foreground");
  });
});

describe("and when it is worth asking for all-the-time", () => {
  const base = {
    wanted: true,
    backgroundBuild: true,
    foregroundGranted: true,
    backgroundGranted: false,
    alreadyAsked: false,
  };

  it("asks when a route starts, with the reason on screen", () => {
    expect(shouldRequestBackground(base)).toBe(true);
  });

  it("never asks in a build without the declaration", () => {
    expect(shouldRequestBackground({ ...base, backgroundBuild: false })).toBe(
      false,
    );
  });

  it("never asks before there is a route to explain it", () => {
    // Asking out of context is asking a stranger for their address, and
    // Android offers this prompt once in a way that matters.
    expect(shouldRequestBackground({ ...base, wanted: false })).toBe(false);
  });

  it("never asks before the basic permission is granted", () => {
    expect(shouldRequestBackground({ ...base, foregroundGranted: false })).toBe(
      false,
    );
  });

  it("does not ask twice", () => {
    expect(shouldRequestBackground({ ...base, alreadyAsked: true })).toBe(
      false,
    );
  });

  it("and stops asking once it is granted", () => {
    expect(shouldRequestBackground({ ...base, backgroundGranted: true })).toBe(
      false,
    );
  });
});

describe("the state a batch of fixes leaves behind", () => {
  it("keeps a fix that moved and drops one that did not", () => {
    const first = ingestInto(EMPTY_STATE, [ping()]);

    expect(first.kept).toBe(1);

    const parked = ingestInto(first.state, [
      ping({ recorded_at: new Date(AT.getTime() + 15_000).toISOString() }),
    ]);

    expect(parked.kept, "um caminhão parado encheu o buffer").toBe(0);
  });

  it("applies the stationary filter ACROSS a batch, not only against storage", () => {
    /**
     * The difference between the two contexts, in one assertion.
     *
     * The foreground watcher hands one fix at a time, so filtering against the
     * last STORED one is the same thing. The background task hands whatever
     * the OS batched while the screen was off — twenty fixes of a truck parked
     * at an address. Filtering each of them against the state as it was when
     * the batch arrived keeps all twenty.
     */
    const parked = Array.from({ length: 20 }, (_, index) =>
      ping({
        recorded_at: new Date(AT.getTime() + index * 15_000).toISOString(),
      }),
    );

    const result = ingestInto(EMPTY_STATE, parked);

    expect(result.kept).toBe(1);
    expect(result.state.buffer).toHaveLength(1);
  });

  it("still keeps one every five minutes while parked", () => {
    // A trail that simply stopped is indistinguishable from a phone that died.
    const first = ingestInto(EMPTY_STATE, [ping()]);

    const later = ingestInto(first.state, [
      ping({
        recorded_at: new Date(
          AT.getTime() + STATIONARY_KEEPALIVE_MS,
        ).toISOString(),
      }),
    ]);

    expect(later.kept).toBe(1);
  });

  it("asks for a flush once the batch fills the window", () => {
    const fixes = Array.from({ length: 20 }, (_, index) => movedPing(index));

    const result = ingestInto(
      { ...EMPTY_STATE, lastFlushAt: AT.getTime() },
      fixes,
      AT.getTime(),
    );

    expect(result.kept).toBe(20);
    expect(result.flushNow).toBe(true);
  });

  it("and ignores everything once the API said to stop", () => {
    const stopped = { ...EMPTY_STATE, stopped: true };

    const result = ingestInto(stopped, [movedPing(1), movedPing(2)]);

    expect(result.kept).toBe(0);
    expect(result.state).toBe(stopped);
  });
});

describe("what a flush leaves behind", () => {
  it("records when it happened and whether to carry on", () => {
    const after = afterFlushSuccess(EMPTY_STATE, true, AT.getTime());

    expect(after.lastFlushAt).toBe(AT.getTime());
    expect(after.stopped).toBe(false);
  });

  it("obeys the API when it says the route is over", () => {
    expect(afterFlushSuccess(EMPTY_STATE, false, AT.getTime()).stopped).toBe(
      true,
    );
  });

  it("keeps a failed batch IN FRONT of what arrived meanwhile", () => {
    /**
     * A trail is only readable in order. The batch that failed is older than
     * whatever the phone collected while the request was in flight; it never
     * left the stored buffer, so nothing settled means nothing moves — it is
     * still at the front, the newer points after it.
     */
    const sending = [movedPing(1), movedPing(2)];
    const arrived = [movedPing(10), movedPing(11)];

    const after = afterFlushAttempt(
      { ...EMPTY_STATE, buffer: [...sending, ...arrived] },
      [],
    );

    expect(
      after.buffer.map((entry: TrackablePing) => entry.recorded_at),
    ).toEqual([
      sending[0].recorded_at,
      sending[1].recorded_at,
      arrived[0].recorded_at,
      arrived[1].recorded_at,
    ]);
  });

  it("and re-applies the ceiling when the restored buffer overflows it", () => {
    // A state restored above the cap (an older build, two contexts writing)
    // would otherwise carry more than any flush may ever drain.
    const over = Array.from({ length: MAX_BUFFERED + 10 }, (_, index) =>
      movedPing(index),
    );

    const after = afterFlushAttempt({ ...EMPTY_STATE, buffer: over }, []);

    expect(after.buffer).toHaveLength(MAX_BUFFERED);

    // The newest survive: they are what somebody is looking at a map for.
    expect(after.buffer[after.buffer.length - 1].recorded_at).toBe(
      movedPing(MAX_BUFFERED + 9).recorded_at,
    );
  });
});

describe("what a driver mid-route keeps when the app updates", () => {
  it("carries the old buffer over", () => {
    const legacy = [movedPing(1), movedPing(2)];

    const restored = restoreFrom(null, legacy);

    expect(restored.buffer).toEqual(legacy);
  });

  it("and takes the last of them as the stationary reference", () => {
    /**
     * Otherwise the first fix after an update is always kept, however little
     * moved — which is the bug this whole filter exists to prevent, reappearing
     * once per release.
     */
    const legacy = [movedPing(1), movedPing(2)];

    expect(restoreFrom(null, legacy).lastKept).toEqual(legacy[1]);
  });

  it("prefers the new state when there is one", () => {
    const saved = { buffer: [movedPing(5)], stopped: true };

    const restored = restoreFrom(saved, [movedPing(1)]);

    expect(restored.buffer).toEqual(saved.buffer);
    expect(restored.stopped).toBe(true);
  });

  it("and fills in anything the saved state is missing", () => {
    // A state written by an older version has fewer fields; spreading it over
    // the empty one is what keeps `lastFlushAt` from arriving as undefined and
    // making `shouldFlush` answer on a value it never saw.
    const restored = restoreFrom({ buffer: [] }, null);

    expect(restored.lastFlushAt).toBeNull();
    expect(restored.stopped).toBe(false);
  });
});

describe("the ceiling itself", () => {
  it("drops from the front", () => {
    const over = Array.from({ length: MAX_BUFFERED + 10 }, (_, index) =>
      movedPing(index),
    );

    const capped = capBuffer(over);

    expect(capped).toHaveLength(MAX_BUFFERED);
    expect(capped[0].recorded_at).toBe(movedPing(10).recorded_at);
  });
});
