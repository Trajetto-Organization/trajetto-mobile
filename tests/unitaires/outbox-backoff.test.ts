import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import {
  RETRY_DELAYS_MS,
  nextAfterFailure,
} from "@/features/submissions/outbox-rules";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";

/**
 * When a failed item is tried again (MOB-12).
 *
 * The delays were a fixed table, so every phone whose items failed together —
 * a deploy, a database blink — came back together, on the same schedule, and
 * failed together again. And when the API said how long to wait (`Retry-After`
 * on a 429 or a 503), nobody read it: the queue came back after fifteen
 * seconds regardless.
 */

describe("the delay after a failure", () => {
  const base = RETRY_DELAYS_MS[2];

  it("is spread around the schedule, so items that failed together do not return together", () => {
    const early = nextAfterFailure({ attempts: 1 }, "transient", 0, {
      random: () => 0,
    });
    const late = nextAfterFailure({ attempts: 1 }, "transient", 0, {
      random: () => 0.999,
    });

    expect(early?.nextAttemptAt).toBe(base * 0.5);
    expect(late?.nextAttemptAt).toBeGreaterThan(base * 1.49);
    expect(late?.nextAttemptAt).toBeLessThanOrEqual(base * 1.5);
  });

  it("is random by default", () => {
    const delays = new Set(
      Array.from(
        { length: 20 },
        () => nextAfterFailure({ attempts: 1 }, "transient", 0)?.nextAttemptAt,
      ),
    );

    expect(delays.size).toBeGreaterThan(1);
  });

  it("waits as long as the API asked, when that is longer", () => {
    const next = nextAfterFailure({ attempts: 0 }, "transient", 1_000, {
      random: () => 0.5,
      retryAfterMs: 600_000,
    });

    expect(next?.nextAttemptAt).toBe(601_000);
  });

  it("never lets the API's answer push the retry past fifteen minutes", () => {
    // The same promise the schedule makes: the queue is emptied before the
    // driver hands the phone in, not on a timer measured in hours.
    const next = nextAfterFailure({ attempts: 0 }, "transient", 0, {
      random: () => 0.5,
      retryAfterMs: 5 * 60 * 60_000,
    });

    expect(next?.nextAttemptAt).toBe(15 * 60_000);
  });

  it("keeps its own schedule when the API asked for less", () => {
    const next = nextAfterFailure({ attempts: 2 }, "transient", 0, {
      random: () => 0.5,
      retryAfterMs: 1_000,
    });

    expect(next?.nextAttemptAt).toBe(RETRY_DELAYS_MS[3]);
  });
});

// ------------------------------------------------ the queue, end to end
const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

vi.mock("expo-file-system", () => {
  class Directory {
    exists = false;
    create() {}
    delete() {}
  }

  return { Directory, File: class {}, Paths: { document: "doc" } };
});

vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries: async () => undefined },
}));

vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: class UploadError extends Error {},
  uploadToStorage: async () => [],
}));

const request = vi.fn();

vi.mock("@/utils/api", async () => {
  const { ApiError: RealApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>(
      "@/utils/api-error",
    );

  return { ApiError: RealApiError, apiClient: { request } };
});

let outbox: typeof import("@/features/submissions/outbox");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
});

describe("the queue, when the API says to slow down", () => {
  beforeEach(() => {
    disk.clear();
    request.mockReset();
    setSubmissionOwner("user-a");

    disk.set(
      "@trajetto:outbox:v1",
      JSON.stringify([
        {
          id: "item-1",
          kind: "fuel",
          businessId: "business-1",
          ownerUserId: "user-a",
          endpoint: "/fuel/create-fuel/business-1",
          body: {},
          photos: [],
          uploadType: "odometerPhotos",
          photoField: "photo",
          createdAt: new Date(0).toISOString(),
          attempts: 0,
          nextAttemptAt: 0,
          status: "pending",
        },
      ]),
    );
  });

  it("does not come back before the Retry-After of a 429", async () => {
    request.mockRejectedValue(
      new ApiError(
        "Muitas requisições",
        429,
        "Too Many Requests",
        "HTTP",
        "RATE_LIMITED",
        10 * 60_000,
      ),
    );

    const before = Date.now();
    await outbox.processOutbox();

    const [item] = JSON.parse(disk.get("@trajetto:outbox:v1") ?? "[]");

    expect(item.status).toBe("pending");
    expect(item.attempts).toBe(1);
    expect(item.nextAttemptAt).toBeGreaterThanOrEqual(before + 10 * 60_000);
  });

  it("tells the telemetry when an item is refused for good (MOB-10)", async () => {
    // A proof marked failed used to be visible only on the driver's pending
    // screen; the operation found out when the customer asked for it.
    const { setTelemetrySink } = await import("@/utils/telemetry");
    const sink = vi.fn();
    setTelemetrySink(sink);

    request.mockRejectedValue(
      new ApiError(
        "Quilometragem inválida",
        400,
        "Bad Request",
        "HTTP",
        "VEHICLE_MILEAGE_INVALID",
      ),
    );

    await outbox.processOutbox();

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "outbox_item_failed",
        tags: expect.objectContaining({
          kind: "fuel",
          failure: "permanent",
          code: "VEHICLE_MILEAGE_INVALID",
        }),
      }),
    );

    setTelemetrySink(null);
  });
});
