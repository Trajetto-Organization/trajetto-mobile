import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";

/**
 * A submission the API told to slow down, on the DIRECT path (MOB-12).
 *
 * The queue already waits out a `Retry-After` when one of ITS attempts gets a
 * 429 or a 503. But most submissions meet the limiter on their first try, from
 * the screen, and `submitOrQueue` handed them to the queue due immediately:
 * the next sweep, at most thirty seconds later, sent the same request into
 * the same overload the API had just asked every phone to wait out.
 *
 * Everything below the HTTP client and the storage upload is real here.
 */

const OUTBOX_KEY = "@trajetto:outbox:v1";
const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
    getAllKeys: async () => [...disk.keys()],
    multiRemove: async (keys: string[]) => keys.forEach((k) => disk.delete(k)),
  },
}));

vi.mock("expo-file-system", () => {
  class Directory {
    exists = false;
    create() {}
    delete() {}
    list() {
      return [];
    }
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

let submitOrQueue: typeof import("@/features/submissions/submit-or-queue").submitOrQueue;

beforeAll(async () => {
  ({ submitOrQueue } = await import("@/features/submissions/submit-or-queue"));
});

const submit = () =>
  submitOrQueue({
    submissionId: "submission-1",
    kind: "fuel",
    endpoint: "/fuel/create-fuel/business-1",
    body: { liters: 40 },
    businessId: "business-1",
    vehicleId: "vehicle-1",
    entries: [],
    uploadType: "odometerPhotos",
    photoField: "photo",
  });

const limited = (retryAfterMs?: number) =>
  new ApiError(
    "Muitas requisições",
    429,
    "Too Many Requests",
    "HTTP",
    "RATE_LIMITED",
    retryAfterMs,
  );

const queuedItem = () => {
  const [item] = JSON.parse(disk.get(OUTBOX_KEY) ?? "[]");
  return item as { nextAttemptAt: number; attempts: number; status: string };
};

beforeEach(() => {
  disk.clear();
  request.mockReset();
  setSubmissionOwner("user-a");
});

describe("a submission the API rate-limited on its first try", () => {
  it("is queued to wait out the Retry-After, not sent again on the next sweep", async () => {
    request.mockRejectedValue(limited(2 * 60_000));

    const before = Date.now();
    await expect(submit()).resolves.toBe("queued");

    const item = queuedItem();
    expect(item.status).toBe("pending");
    expect(item.attempts).toBe(0);
    expect(item.nextAttemptAt).toBeGreaterThanOrEqual(before + 2 * 60_000);
  });

  it("never waits longer than the schedule's own ceiling", async () => {
    request.mockRejectedValue(limited(5 * 60 * 60_000));

    await submit();

    expect(queuedItem().nextAttemptAt).toBeLessThanOrEqual(
      Date.now() + 15 * 60_000,
    );
  });

  it("is due at once when nothing asked it to wait", async () => {
    request.mockRejectedValue(
      new ApiError("Sem conexão", 0, "Network Error", "NETWORK"),
    );

    await submit();

    expect(queuedItem().nextAttemptAt).toBeLessThanOrEqual(Date.now());
  });
});
