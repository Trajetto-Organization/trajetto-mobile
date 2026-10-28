import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrackablePing } from "@/features/tracking/position-rules";

/**
 * A flush the OS cuts short.
 *
 * The reporter took each batch OUT of storage before its `POST
 * /route/positions`. The background task is the JavaScript context Android
 * kills most, and often mid-request: the batch was in no one's hands any
 * more, and up to two hundred points of the trail were gone. The batch now
 * stays stored until the API answers, and only what the API settled leaves —
 * never the points another context appended meanwhile. Resending a batch the
 * API already took is safe: it keeps one copy of a resent point.
 *
 * The reporter's own loop, with storage in a Map (JSON copies, like
 * AsyncStorage) and an API whose every answer the test decides.
 */
const storage = new Map<string, unknown>();

class FakeApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

type Post = (pings: TrackablePing[]) => Promise<unknown>;

const ok = (pings: TrackablePing[]) => ({
  data: { stored: pings.length, rejected: 0, tracking: true },
});

let post: Post = async (pings) => ok(pings);
const posted: TrackablePing[][] = [];

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
  logger: {
    warn: () => undefined,
    error: () => undefined,
    info: () => undefined,
  },
}));

vi.mock("@/utils/api", () => ({
  ApiError: FakeApiError,
  apiClient: {
    post: (_url: string, body: { pings: TrackablePing[] }) => {
      posted.push(body.pings);
      return post(body.pings);
    },
  },
}));

const { MAX_BUFFERED, MAX_FLUSH_BATCH, appendPing } =
  await import("@/features/tracking/position-rules");

type Reporter = typeof import("@/features/tracking/reporter");

/** A fresh module: what a process the OS killed starts from (empty queue). */
async function freshReporter(): Promise<Reporter> {
  vi.resetModules();
  return import("@/features/tracking/reporter");
}

const STATE_KEY = "driver_position_state";

function signIn(userId: string): void {
  storage.set("auth-store", { state: { user: { id: userId } }, version: 0 });
}

/** A truck on the move: every point far enough from the last to be kept. */
function trail(count: number, from = 0): TrackablePing[] {
  const start = Date.parse("2026-10-28T08:00:00.000Z");

  return Array.from({ length: count }, (_, index) => ({
    latitude: -23.55 + (from + index) * 0.01,
    longitude: -46.63,
    accuracy: 10,
    speed: 40,
    recorded_at: new Date(start + (from + index) * 15_000).toISOString(),
  })) as TrackablePing[];
}

function storedBuffer(): TrackablePing[] {
  return (
    (storage.get(STATE_KEY) as { buffer?: TrackablePing[] } | undefined)
      ?.buffer ?? []
  );
}

const instants = (pings: TrackablePing[]) =>
  pings.map((ping) => ping.recorded_at);

/** A buffer as a previous flush left it, owned by `driver-a`. */
function storeBuffer(buffer: TrackablePing[]): void {
  storage.set(STATE_KEY, {
    buffer,
    lastKept: buffer[buffer.length - 1] ?? null,
    lastFlushAt: Date.now(),
    stopped: false,
    ownerId: "driver-a",
  });
}

/**
 * What the background task (a second JavaScript context, its own queue)
 * does while the foreground's request is in flight: appends to the stored
 * buffer, under the same cap as `appendPing`.
 */
function appendFromAnotherContext(pings: TrackablePing[]): void {
  const state = storage.get(STATE_KEY) as { buffer: TrackablePing[] };
  let buffer = state.buffer;

  for (const ping of pings) buffer = appendPing(buffer, ping);

  storage.set(STATE_KEY, JSON.parse(JSON.stringify({ ...state, buffer })));
}

/** Lets the flush reach its request (storage reads are awaited first). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  storage.clear();
  posted.length = 0;
  post = async (pings) => ok(pings);
  signIn("driver-a");
});

describe("a flush killed mid-request", () => {
  it("leaves the whole batch in storage while the request never answers", async () => {
    const reporter = await freshReporter();
    const points = trail(150);
    storeBuffer(points);

    // The OS freezes the process with the request in flight: no answer, ever.
    post = () => new Promise(() => undefined);
    void reporter.flush();
    await settle();

    expect(posted).toHaveLength(1);
    expect(instants(storedBuffer())).toEqual(instants(points));
  });

  it("sends that batch again after the restart, and only then lets it go", async () => {
    storeBuffer(trail(150));

    const killed = await freshReporter();
    post = () => new Promise(() => undefined);
    void killed.flush();
    await settle();

    // The process starts again (a fresh module, an empty queue), with signal.
    post = async (pings) => ok(pings);
    const restarted = await freshReporter();
    const result = await restarted.flush();

    expect(result.sent).toBe(150);
    expect(posted[1]).toHaveLength(150);
    expect(storedBuffer()).toEqual([]);
  });

  it("keeps every batch not yet answered when the kill comes mid-way through a long flush", async () => {
    const reporter = await freshReporter();
    const points = trail(450);
    storeBuffer(points);

    // The first batch is taken; the second request never answers.
    post = async (pings) => {
      if (posted.length === 1) return ok(pings);
      return new Promise(() => undefined);
    };
    void reporter.flush();
    await settle();
    await settle();

    expect(posted).toHaveLength(2);
    expect(instants(storedBuffer())).toEqual(
      instants(points.slice(MAX_FLUSH_BATCH)),
    );
  });
});

describe("a flush the API answers", () => {
  it("removes exactly the points it sent, never the ones appended meanwhile", async () => {
    const reporter = await freshReporter();
    const sent = trail(20);
    const arrived = trail(5, 100);
    storeBuffer(sent);

    // Only during the first request: the second one carries what arrived.
    post = async (pings) => {
      if (posted.length === 1) appendFromAnotherContext(arrived);
      return ok(pings);
    };

    const first = await reporter.flush();

    // The loop drains what arrived too, in a second request.
    expect(first.sent).toBe(25);
    expect(instants(posted[0])).toEqual(instants(sent));
    expect(instants(posted[1])).toEqual(instants(arrived));
    expect(storedBuffer()).toEqual([]);
  });

  it("on a transient failure keeps the batch in front of what arrived meanwhile", async () => {
    const reporter = await freshReporter();
    const sent = trail(20);
    const arrived = trail(5, 100);
    storeBuffer(sent);

    post = async () => {
      appendFromAnotherContext(arrived);
      throw new FakeApiError(503);
    };

    const result = await reporter.flush();

    expect(result.sent).toBe(0);
    expect(instants(storedBuffer())).toEqual(instants([...sent, ...arrived]));
  });

  it("lets go of a point refused as invalid, and keeps the rest of a batch cut short", async () => {
    const reporter = await freshReporter();
    const points = trail(4);
    const poisoned = { ...points[1], speed: null } as unknown as TrackablePing;
    storeBuffer([points[0], poisoned, points[2], points[3]]);

    // The schema refuses any piece holding the bad point; the second half
    // then meets a dead network.
    post = async (pings) => {
      if (pings.some((ping) => ping.speed === null))
        throw new FakeApiError(400);
      if (pings.some((ping) => ping.recorded_at === points[2].recorded_at)) {
        throw new FakeApiError(503);
      }
      return ok(pings);
    };

    const result = await reporter.flush();

    // Halving: [0, bad] → [0] taken, [bad] dropped; then [2, 3] fails.
    expect(result.sent).toBe(1);
    expect(instants(storedBuffer())).toEqual(instants([points[2], points[3]]));
  });

  it("never lets the buffer grow past its ceiling while a request is in flight", async () => {
    const reporter = await freshReporter();
    storeBuffer(trail(MAX_BUFFERED));

    let calls = 0;
    post = async () => {
      calls += 1;
      if (calls === 1) appendFromAnotherContext(trail(50, 5_000));
      throw new FakeApiError(503);
    };

    await reporter.flush();

    const buffer = storedBuffer();
    expect(buffer).toHaveLength(MAX_BUFFERED);
    // The newest survive: what arrived during the request is at the end.
    expect(buffer[buffer.length - 1].recorded_at).toBe(
      trail(1, 5_049)[0].recorded_at,
    );
  });

  it("forgets the batch when the API refuses the phone itself (403), as before", async () => {
    const reporter = await freshReporter();
    storeBuffer(trail(30));

    post = async () => {
      throw new FakeApiError(403);
    };

    const result = await reporter.flush();

    expect(result.stopped).toBe(true);
    expect(storedBuffer()).toEqual([]);
  });

  it("keeps the batch for the driver's next sign-in when the session ended (401)", async () => {
    const reporter = await freshReporter();
    const points = trail(30);
    storeBuffer(points);

    post = async () => {
      throw new FakeApiError(401);
    };

    const result = await reporter.flush();

    expect(result.stopped).toBe(true);
    expect(instants(storedBuffer())).toEqual(instants(points));
  });
});
