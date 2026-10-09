import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrackablePing } from "@/features/tracking/position-rules";

/**
 * The position pipeline when the API says no to the phone, and when the
 * driver signs out — the reporter's own loop, with storage in a Map and an
 * API that answers the way the real middleware does.
 *
 * - MOB-TRK-4: only a 400 was a verdict. A 403 MODULE_NOT_ENABLED /
 *   TENANT_INACTIVE / permission went back into the buffer and was sent again
 *   on every flush, forever, with the GPS on.
 * - MOB-24: the flush on the way out ran after the logout had cleared the
 *   session, found nobody signed in, and sent nothing: the last stretch of
 *   the route was lost.
 */

const storage = new Map<string, unknown>();

class FakeApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
    public nonJsonBody = false,
  ) {
    super(`HTTP ${status}`);
  }
}

type Answer = { status: number; code?: string; nonJsonBody?: boolean } | "ok";

let answer: Answer = "ok";

const posted: TrackablePing[][] = [];
const requests: Array<{ endpoint: string; config: Record<string, unknown> }> = [];

const respond = (pings: TrackablePing[]) => {
  if (answer !== "ok") {
    throw new FakeApiError(answer.status, answer.code, answer.nonJsonBody);
  }

  posted.push(pings);

  return { data: { stored: pings.length, rejected: 0, tracking: true } };
};

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
    post: async (_url: string, body: { pings: TrackablePing[] }) =>
      respond(body.pings),
    request: async (
      endpoint: string,
      config: { body: { pings: TrackablePing[] } } & Record<string, unknown>,
    ) => {
      requests.push({ endpoint, config });
      return respond(config.body.pings);
    },
  },
}));

const reporter = await import("@/features/tracking/reporter");

function signIn(userId: string | null): void {
  if (userId === null) {
    storage.delete("auth-store");
    return;
  }

  storage.set("auth-store", { state: { user: { id: userId } }, version: 0 });
}

function trail(count: number, from = 0): TrackablePing[] {
  const start = Date.parse("2026-09-28T08:00:00.000Z");

  return Array.from({ length: count }, (_, index) => ({
    latitude: -23.55 + (from + index) * 0.01,
    longitude: -46.63,
    accuracy: 10,
    speed: 40,
    recorded_at: new Date(start + (from + index) * 15_000).toISOString(),
  })) as TrackablePing[];
}

/** Buffers `count` points while the API is unreachable. */
async function bufferOffline(count: number): Promise<void> {
  answer = { status: 503 };
  await reporter.ingest(trail(count));
  answer = "ok";
}

beforeEach(() => {
  storage.clear();
  posted.length = 0;
  requests.length = 0;
  answer = "ok";
});

describe("a 403 from the API is a verdict on the phone (MOB-TRK-4)", () => {
  for (const code of ["MODULE_NOT_ENABLED", "TENANT_INACTIVE", undefined]) {
    it(`stops and clears the buffer on ${code ?? "a permission refusal"}`, async () => {
      signIn("driver-a");
      await bufferOffline(5);

      answer = { status: 403, code };

      const result = await reporter.flush();

      expect(result.stopped).toBe(true);
      expect((await reporter.readState()).buffer).toEqual([]);

      // And it is not retried: nothing is posted on the next flush, and new
      // fixes are not collected until a route starts again.
      answer = "ok";

      const next = await reporter.flush();
      const ingested = await reporter.ingest(trail(3, 100));

      expect(next.sent).toBe(0);
      expect(ingested.kept).toBe(0);
      expect(ingested.halt).toBe(true);
      expect(posted).toEqual([]);
    });
  }

  it("keeps retrying a 403 that is not the API's (a proxy page)", async () => {
    signIn("driver-a");
    await bufferOffline(5);

    answer = { status: 403, nonJsonBody: true };

    const result = await reporter.flush();

    expect(result.stopped).toBe(false);
    expect((await reporter.readState()).buffer).toHaveLength(5);
  });

  it("a 401 stops collecting but keeps the driver's own points", async () => {
    signIn("driver-a");
    await bufferOffline(5);

    answer = { status: 401 };

    const result = await reporter.flush();

    expect(result.stopped).toBe(true);
    expect((await reporter.readState()).buffer).toHaveLength(5);

    // Signed in again, a new route resumes and the points go out.
    answer = "ok";
    await reporter.resume();

    expect((await reporter.flush()).sent).toBe(5);
  });
});

describe("the route's last stretch on logout (MOB-24)", () => {
  it("goes out with the session being ended, even once the store is cleared", async () => {
    signIn("driver-a");
    await bufferOffline(7);

    // The logout already cleared the persisted user: the old path's
    // `flush()` found nobody and sent nothing.
    signIn(null);
    expect((await reporter.flush()).sent).toBe(0);

    const sent = await reporter.flushBeforeSignOut({
      userId: "driver-a",
      accessToken: "access-token-of-driver-a",
    });

    expect(sent).toBe(7);
    expect(posted.flat()).toHaveLength(7);

    // The token the logout captured, and no refresh from inside a logout.
    expect(requests[0].endpoint).toBe("/route/positions");
    expect(requests[0].config).toMatchObject({
      method: "POST",
      requiresAuth: false,
      headers: { Authorization: "Bearer access-token-of-driver-a" },
    });
  });

  it("never sends another driver's points", async () => {
    signIn("driver-a");
    await bufferOffline(4);

    const sent = await reporter.flushBeforeSignOut({
      userId: "driver-b",
      accessToken: "access-token-of-driver-b",
    });

    expect(sent).toBe(0);
    expect(requests).toEqual([]);
    expect((await reporter.readState()).buffer).toHaveLength(4);
  });

  it("does not hold the logout on a dead network", async () => {
    vi.useFakeTimers();

    try {
      signIn("driver-a");
      await bufferOffline(3);

      // A request that takes far longer than the logout will wait (the real
      // client gives up at its own timeout; this one is slower still).
      const api = (await import("@/utils/api")).apiClient;
      const spy = vi.spyOn(api, "request").mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new FakeApiError(0)), 30_000),
          ),
      );

      const pending = reporter.flushBeforeSignOut({
        userId: "driver-a",
        accessToken: "token",
        timeoutMs: 1_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toBe(0);

      // The request still settles on its own, and the points are kept.
      await vi.advanceTimersByTimeAsync(30_000);
      spy.mockRestore();

      expect((await reporter.readState()).buffer).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a token that no longer works leaves the points for the next sign-in", async () => {
    signIn("driver-a");
    await bufferOffline(2);

    answer = { status: 401 };

    const sent = await reporter.flushBeforeSignOut({
      userId: "driver-a",
      accessToken: "expired",
    });

    expect(sent).toBe(0);
    expect((await reporter.readState()).buffer).toHaveLength(2);
  });
});
