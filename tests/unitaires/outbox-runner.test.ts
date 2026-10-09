import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";

/**
 * The queue's runner, not only its rules (TESTS-11).
 *
 * The promise the offline mode makes to a driver is "send it and forget it":
 * a proof, a fueling or a checklist queued without signal gets there exactly
 * once, however many times the network drops on the way. The pure rules were
 * tested; the code that actually walks the queue — sends, removes, backs off,
 * stops — was not. These run the real `outbox.ts` over an in-memory disk and
 * a fake API, and pin the three things a refactor could quietly break:
 *
 * - a resend carries the SAME idempotency key, in the body and in the header,
 *   and the item leaves the queue once it lands;
 * - two passes started at once are one pass, so nothing is sent twice;
 * - an expired session stops the pass and leaves the item exactly as it was.
 */

// ---------------------------------------------------------------- natives
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

  // Photos already in storage: the keys the previous attempt recorded.
  uploadToStorage: async ({
    entries,
  }: {
    entries: { uploadedKey?: string; fieldName?: string }[];
  }) =>
    entries.map((entry) => ({
      key: entry.uploadedKey ?? "fresh-key",
      fieldName: entry.fieldName,
    })),
}));

type Sent = {
  endpoint: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

const sent: Sent[] = [];
const request = vi.fn();

vi.mock("@/utils/api", async () => {
  const { ApiError: RealApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>(
      "@/utils/api-error",
    );

  return {
    ApiError: RealApiError,
    apiClient: {
      request: async (
        endpoint: string,
        config: { body: Record<string, unknown>; headers: Record<string, string> },
      ) => {
        // Recorded BEFORE the outcome: a request whose answer is lost still
        // reached the server.
        sent.push({ endpoint, body: config.body, headers: config.headers });

        return request(endpoint, config);
      },
    },
  };
});

const STORAGE_KEY = "@trajetto:outbox:v1";

let outbox: typeof import("@/features/submissions/outbox");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
});

function queued(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "fuel",
    businessId: "business-1",
    ownerUserId: "user-a",
    vehicleId: "vehicle-1",
    endpoint: "/fuel/create-fuel/business-1",
    body: { client_submission_id: id, current_mileage: 1_000 },
    photos: [
      {
        uri: "file:///odometer.jpg",
        fileName: "odometer.jpg",
        fileSize: 1024,
        mimeType: "image/jpeg",
        uploadedKey: `odometerPhotos/business-1/${id}.jpg`,
      },
    ],
    uploadType: "odometerPhotos",
    photoField: "photo",
    createdAt: new Date(0).toISOString(),
    attempts: 0,
    nextAttemptAt: 0,
    status: "pending",
    ...overrides,
  };
}

function onDisk(): Array<Record<string, unknown>> {
  return JSON.parse(disk.get(STORAGE_KEY) ?? "[]");
}

const networkDown = () =>
  new ApiError("Network request failed", 0, "Network Error", "NETWORK");

beforeEach(() => {
  disk.clear();
  sent.length = 0;
  request.mockReset();
  vi.restoreAllMocks();

  setSubmissionOwner("user-a");
});

describe("a submission whose answer was lost", () => {
  it("is sent again with the same key, and leaves the queue once it lands", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([queued("fuel-1")]));

    // The request reached the server; the answer did not reach the phone.
    request.mockRejectedValueOnce(networkDown());
    await outbox.processOutbox();

    expect(onDisk()).toHaveLength(1);
    expect(onDisk()[0]).toMatchObject({ status: "pending", attempts: 1 });

    // Later, when the backoff is over, the network is back.
    const later = Date.now() + 60 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);

    request.mockResolvedValueOnce({ id: "fuel-row" });
    await outbox.processOutbox();

    expect(sent).toHaveLength(2);

    for (const attempt of sent) {
      expect(attempt.endpoint).toBe("/fuel/create-fuel/business-1");
      expect(attempt.body.client_submission_id).toBe("fuel-1");
      expect(attempt.headers["Idempotency-Key"]).toBe("fuel-1");

      // The photo already in storage is referenced, not sent again.
      expect(attempt.body.photo).toEqual({
        key: "odometerPhotos/business-1/fuel-1.jpg",
      });
    }

    expect(sent[1].body).toEqual(sent[0].body);
    expect(onDisk()).toEqual([]);
  });
});

describe("two passes started at the same moment", () => {
  it("are one pass: every item is sent once", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([queued("fuel-1"), queued("fuel-2")]),
    );

    // Slow enough that the second call arrives while the first is sending.
    request.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({}), 20)),
    );

    await Promise.all([outbox.processOutbox(), outbox.processOutbox()]);

    expect(sent.map((attempt) => attempt.body.client_submission_id)).toEqual([
      "fuel-1",
      "fuel-2",
    ]);
    expect(onDisk()).toEqual([]);
  });
});

describe("a session that ended while the queue was sending", () => {
  it("stops the pass and leaves the item exactly as it was", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([queued("fuel-1"), queued("fuel-2")]),
    );

    request.mockRejectedValueOnce(
      new ApiError(
        "Sessão expirada",
        401,
        "Unauthorized",
        "HTTP",
        "AUTH_SESSION_INVALID",
      ),
    );

    await outbox.processOutbox();

    // Nothing else is tried under a dead session.
    expect(sent).toHaveLength(1);

    const [first, second] = onDisk();

    expect(first).toMatchObject({
      id: "fuel-1",
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
    });
    expect(first.lastError).toBeUndefined();
    expect(second).toMatchObject({ id: "fuel-2", status: "pending", attempts: 0 });
  });
});
