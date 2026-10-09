import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The background task ends itself (MOB-TRK-3).
 *
 * With background tracking on and the app killed, the task is the only code
 * running: the React effect that stops location updates does not exist. The
 * API answered `tracking: false`, the fixes were dropped one by one, and the
 * GPS and the "Rota em andamento" notification ran on until the driver opened
 * the app.
 *
 * The executor is the one the module registers with the OS — captured from
 * `TaskManager.defineTask` — driven with a batch of fixes and an API that
 * answers the way `/route/positions` does.
 */

type Executor = (body: {
  data?: { locations?: unknown[] };
  error: unknown;
  executionInfo: unknown;
}) => Promise<void>;

const registered = new Map<string, Executor>();

vi.mock("expo-task-manager", () => ({
  defineTask: (name: string, executor: Executor) => {
    registered.set(name, executor);
  },
}));

const locationUpdates = { running: true, stops: 0 };

vi.mock("expo-location", () => ({
  hasStartedLocationUpdatesAsync: async () => locationUpdates.running,
  stopLocationUpdatesAsync: async () => {
    locationUpdates.stops += 1;
    locationUpdates.running = false;
  },
}));

const storage = new Map<string, unknown>();

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

class FakeApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

let routeRunning = true;
let refusal: number | null = null;

vi.mock("@/utils/api", () => ({
  ApiError: FakeApiError,
  apiClient: {
    post: async (_url: string, body: { pings: unknown[] }) => {
      if (refusal) throw new FakeApiError(refusal);

      return {
        data: { stored: body.pings.length, rejected: 0, tracking: routeRunning },
      };
    },
  },
}));

await import("@/features/tracking/background-task");

const executor = registered.get("trajetto-driver-location")!;

const fix = (index: number) => ({
  coords: {
    latitude: -23.55 + index * 0.01,
    longitude: -46.63,
    accuracy: 10,
    speed: 12,
    heading: 90,
    altitude: null,
    altitudeAccuracy: null,
  },
  timestamp: Date.parse("2026-09-28T09:00:00.000Z") + index * 15_000,
});

const wake = (locations: unknown[]) =>
  executor({ data: { locations }, error: null, executionInfo: {} });

beforeEach(() => {
  storage.clear();
  storage.set("auth-store", { state: { user: { id: "driver-a" } }, version: 0 });

  locationUpdates.running = true;
  locationUpdates.stops = 0;

  routeRunning = true;
  refusal = null;
});

describe("the background location task", () => {
  it("stops the OS updates once the API says the route is over", async () => {
    routeRunning = false;

    await wake([fix(0), fix(1)]);

    expect(locationUpdates.stops).toBe(1);
    expect(locationUpdates.running).toBe(false);
  });

  it("stops them when the API refuses the phone (module switched off)", async () => {
    refusal = 403;

    await wake([fix(0)]);

    expect(locationUpdates.stops).toBe(1);
  });

  it("stops them when nobody is signed in any more", async () => {
    storage.delete("auth-store");

    await wake([fix(0)]);

    expect(locationUpdates.stops).toBe(1);
  });

  it("keeps them running while the route runs", async () => {
    await wake([fix(0), fix(1)]);

    expect(locationUpdates.stops).toBe(0);
    expect(locationUpdates.running).toBe(true);
  });

  it("keeps them running through a moment without signal", async () => {
    refusal = 503;

    await wake([fix(0)]);

    expect(locationUpdates.stops).toBe(0);
  });
});
