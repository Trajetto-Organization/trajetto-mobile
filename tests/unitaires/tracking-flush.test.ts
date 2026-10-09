import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrackablePing } from "@/features/tracking/position-rules";

/**
 * The flush, with the API's real limits and a device two people use.
 *
 * Two defects lived in the reporter's loop, not in any rule a pure test could
 * reach, so this one drives the loop itself — with storage in a Map and an API
 * that answers the way the real schema does.
 *
 *  - The buffer holds up to 900 points and went out in ONE request; the API
 *    refuses more than 500. Past that, every flush was refused, the batch went
 *    back, and tracking on that phone was dead for good.
 *  - The state is the device's, not the session's. The points of the driver
 *    who logged out went out with the next driver's token, into their trail.
 */
const API_MAX_PINGS_PER_BATCH = 500;

const storage = new Map<string, unknown>();

class FakeApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

const posted: TrackablePing[][] = [];
let online = true;

vi.mock("@/utils/storage", () => ({
  asyncStorage: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      storage.set(key, JSON.parse(JSON.stringify(value)));
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
  },
}));

vi.mock("@/utils/logger", () => ({
  logger: { warn: () => undefined, error: () => undefined, info: () => undefined },
}));

vi.mock("@/utils/api", () => ({
  ApiError: FakeApiError,
  apiClient: {
    post: async (_url: string, body: { pings: TrackablePing[] }) => {
      if (!online) throw new FakeApiError(503);

      // The route's zod schema: at most 500, and every number a number.
      if (
        body.pings.length > API_MAX_PINGS_PER_BATCH ||
        body.pings.some((ping) => ping.speed === null)
      ) {
        throw new FakeApiError(400);
      }

      posted.push(body.pings);

      return { data: { stored: body.pings.length, rejected: 0, tracking: true } };
    },
  },
}));

const { MAX_FLUSH_BATCH } = await import("@/features/tracking/position-rules");
const reporter = await import("@/features/tracking/reporter");

function signIn(userId: string | null): void {
  if (userId === null) {
    storage.delete("auth-store");
    return;
  }

  storage.set("auth-store", { state: { user: { id: userId } }, version: 0 });
}

/** A truck on the move: every point far enough from the last to be kept. */
function trail(count: number, from = 0): TrackablePing[] {
  const start = Date.parse("2026-09-23T08:00:00.000Z");

  return Array.from({ length: count }, (_, index) => ({
    latitude: -23.55 + (from + index) * 0.01,
    longitude: -46.63,
    accuracy: 10,
    speed: 40,
    recorded_at: new Date(start + (from + index) * 15_000).toISOString(),
  })) as TrackablePing[];
}

beforeEach(() => {
  storage.clear();
  posted.length = 0;
  online = true;
});

describe("a buffer that grew past what one request may carry", () => {
  it("drains completely, in requests the API accepts", async () => {
    signIn("driver-a");

    // Two hours in a dead zone: the fixes pile up and every flush fails.
    online = false;
    for (let index = 0; index < 700; index += 50) {
      await reporter.ingest(trail(50, index));
    }

    expect((await reporter.readState()).buffer.length).toBe(700);

    // Signal again.
    online = true;
    const result = await reporter.flush();

    expect(result.sent).toBe(700);
    expect((await reporter.readState()).buffer).toEqual([]);

    expect(posted.every((batch) => batch.length <= MAX_FLUSH_BATCH)).toBe(true);
    expect(MAX_FLUSH_BATCH).toBeLessThanOrEqual(API_MAX_PINGS_PER_BATCH);

    // In order: the oldest point went first and the trail reads as driven.
    const sentTimes = posted.flat().map((ping) => ping.recorded_at);
    expect(sentTimes).toEqual([...sentTimes].sort());
  });

  it("keeps what was not sent when the signal drops again mid-way", async () => {
    signIn("driver-a");

    online = false;
    await reporter.ingest(trail(450));

    // One request goes through, then the radio is gone again.
    online = true;
    const post = (await import("@/utils/api")).apiClient.post;
    let calls = 0;
    const spy = vi
      .spyOn((await import("@/utils/api")).apiClient, "post")
      .mockImplementation(async (url, body) => {
        calls += 1;
        if (calls > 1) throw new FakeApiError(503);
        return post(url, body as never) as never;
      });

    const result = await reporter.flush();
    spy.mockRestore();

    expect(result.sent).toBe(MAX_FLUSH_BATCH);
    expect((await reporter.readState()).buffer.length).toBe(450 - MAX_FLUSH_BATCH);
  });
});

describe("one point the schema refuses", () => {
  it("is dropped alone, and the rest still arrives", async () => {
    signIn("driver-a");

    const points = trail(120);
    points[77] = { ...points[77], speed: null as never };

    online = false;
    await reporter.ingest(points);

    online = true;
    const result = await reporter.flush();

    expect(result.sent).toBe(119);
    expect((await reporter.readState()).buffer).toEqual([]);
    expect(posted.flat()).not.toContainEqual(points[77]);
  });
});

describe("a phone two drivers share", () => {
  it("never sends the first driver's points with the second one's token", async () => {
    signIn("driver-a");

    online = false;
    await reporter.ingest(trail(19));

    // Driver A logs out: the cleanup flush has nobody to send as.
    signIn(null);
    online = true;
    expect((await reporter.flush()).sent).toBe(0);

    // Driver B signs in on the same phone and starts moving.
    signIn("driver-b");
    await reporter.ingest(trail(3, 500));
    await reporter.flush();

    const sent = posted.flat();

    expect(sent).toHaveLength(3);
    expect(sent).toEqual(trail(3, 500));
  });

  it("keeps a driver's own points across a logout and back", async () => {
    signIn("driver-a");

    online = false;
    await reporter.ingest(trail(5));

    signIn(null);
    signIn("driver-a");

    online = true;
    expect((await reporter.flush()).sent).toBe(5);
  });
});
