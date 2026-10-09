import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrackablePing } from "@/features/tracking/position-rules";

/**
 * A point the API refuses (400) is dropped and logged. The log line carried
 * the whole point — latitude and longitude of the driver — and logger.warn
 * writes to logcat in production builds, which adb and bug reports collect.
 * The line now says when the point was taken, not where.
 */
const storage = new Map<string, unknown>();
const warnings: unknown[][] = [];

class FakeApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

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
    warn: (...args: unknown[]) => warnings.push(args),
    error: () => undefined,
    info: () => undefined,
    dev: () => undefined,
  },
}));

vi.mock("@/utils/api", () => ({
  ApiError: FakeApiError,
  apiClient: {
    post: async () => {
      throw new FakeApiError(400);
    },
    request: async () => {
      throw new FakeApiError(400);
    },
  },
}));

const reporter = await import("@/features/tracking/reporter");

const POINT = {
  latitude: -23.5617,
  longitude: -46.6559,
  accuracy: 10,
  speed: 40,
  recorded_at: "2026-09-28T08:00:00.000Z",
} as TrackablePing;

beforeEach(() => {
  storage.clear();
  warnings.length = 0;
  storage.set("auth-store", { state: { user: { id: "driver-a" } }, version: 0 });
});

describe("a refused point in the logs", () => {
  it("never carries the driver's coordinates", async () => {
    await reporter.ingest([POINT]);

    const lines = JSON.stringify(warnings);

    expect(warnings.length).toBeGreaterThan(0);
    expect(lines).not.toContain("-23.5617");
    expect(lines).not.toContain("-46.6559");
    expect(lines).toContain("2026-09-28T08:00:00.000Z");
  });
});
