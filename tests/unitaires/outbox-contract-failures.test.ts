import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { setClientVersion } from "@/utils/client-version";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";

import {
  classifyFailure,
  nextAfterFailure,
} from "@/features/submissions/outbox-rules";
import {
  queueAgeWarning,
  shouldRequeueAfterUpgrade,
  upcastOutboxItem,
} from "@/features/submissions/outbox-schema";

/**
 * A queued item whose build no longer speaks the API's contract (GAP5-2).
 *
 * The outbox freezes an item — URL, body and all — when the driver presses
 * send, and delivers it to whatever API is running days later. When that API
 * renamed the route or made a field mandatory, the item came back 404 or 400,
 * was marked failed like a refusal on the merits, and stayed failed: updating
 * the app did not help, "Tentar de novo" sent the same frozen request, and the
 * only way out was to discard the proof.
 *
 * Now a refusal that names a contract is kept apart. The item is still failed
 * and visible — the driver can still discard it — but once the app is updated
 * it is sent again by itself, once. Nothing is ever deleted on age; an old
 * item is only flagged.
 */

describe("a refusal on the contract, not on the merits", () => {
  const api = (code: string) => ({
    source: "api" as const,
    isTransient: false,
    code,
  });

  it("is told apart from one on the merits", () => {
    for (const code of [
      "ROUTE_NOT_FOUND",
      "VALIDATION_ERROR",
      "PHOTO_REQUIRED",
      "PHOTOS_REQUIRED",
      "CLIENT_OUTDATED",
      "CLIENT_UPGRADE_REQUIRED",
      // 410 from the API's tombstone for a route a release removed: the same
      // situation as ROUTE_NOT_FOUND, said on purpose.
      "ENDPOINT_RETIRED",
    ]) {
      expect(classifyFailure(api(code)), code).toBe("contract");
    }

    // The driver has to see these; an update changes nothing.
    expect(classifyFailure(api("VEHICLE_MILEAGE_INVALID"))).toBe("permanent");
    expect(classifyFailure({ source: "api", isTransient: false })).toBe("permanent");
  });

  it("fails the item, where the driver sees it — never parks it", () => {
    // Parked items are unparked whenever the module is seen enabled, which
    // for a contract refusal would resend and refail in a loop.
    const next = nextAfterFailure({ attempts: 0 }, "contract", 1_000);

    expect(next?.status).toBe("failed");
    expect(next?.attempts).toBe(1);
  });
});

describe("an item written by an older build", () => {
  it("is read with the current shape, and otherwise unchanged", () => {
    const legacy = {
      id: "item-1",
      kind: "fuel",
      endpoint: "/fuel/create-fuel/b",
      body: { current_mileage: 10 },
      status: "pending",
    };

    expect(upcastOutboxItem(legacy)).toEqual({ ...legacy, schemaVersion: 1 });
  });

  it("is sent again once the app was updated, if it failed on the contract", () => {
    const failedOnContract = {
      status: "failed" as const,
      failure: "contract" as const,
      failedOnAppVersion: "1.0.0/41",
    };

    expect(shouldRequeueAfterUpgrade(failedOnContract, "1.0.0/42")).toBe(true);
    expect(shouldRequeueAfterUpgrade(failedOnContract, "1.0.0/41")).toBe(false);

    // A refusal on the merits is the driver's to decide, update or not.
    expect(
      shouldRequeueAfterUpgrade(
        { ...failedOnContract, failure: "permanent" as const },
        "1.0.0/42",
      ),
    ).toBe(false);

    // Without a version to compare, nothing moves.
    expect(shouldRequeueAfterUpgrade(failedOnContract, null)).toBe(false);
  });
});

describe("an item that has waited a long time", () => {
  const day = 24 * 60 * 60 * 1000;
  const created = new Date("2026-09-01T12:00:00Z");

  it("is flagged at a week and at two, and never before", () => {
    expect(queueAgeWarning(created.toISOString(), created.getTime() + 6 * day)).toBeNull();

    expect(
      queueAgeWarning(created.toISOString(), created.getTime() + 7 * day),
    ).toEqual({ days: 7, level: "warning" });

    expect(
      queueAgeWarning(created.toISOString(), created.getTime() + 15 * day),
    ).toEqual({ days: 15, level: "critical" });
  });

  it("says nothing about a date it cannot read", () => {
    expect(queueAgeWarning("not a date", Date.now())).toBeNull();
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

const STORAGE_KEY = "@trajetto:outbox:v1";

let outbox: typeof import("@/features/submissions/outbox");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
});

const OLD_BUILD = { platform: "android", version: "1.0.0", build: 41, update: "ota-a" };
const NEW_BUILD = { platform: "android", version: "1.0.0", build: 41, update: "ota-b" };

function stored() {
  return JSON.parse(disk.get(STORAGE_KEY) ?? "[]");
}

describe("the queue across an app update", () => {
  beforeEach(() => {
    disk.clear();
    request.mockReset();
    setSubmissionOwner("user-a");

    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        {
          id: "proof-1",
          kind: "delivery-proof",
          businessId: "business-1",
          ownerUserId: "user-a",
          endpoint: "/delivery/proof/d/business/business-1",
          body: { client_submission_id: "proof-1" },
          photos: [],
          uploadType: "deliveryPhotos",
          photoField: "proof",
          createdAt: new Date().toISOString(),
          attempts: 0,
          nextAttemptAt: 0,
          status: "pending",
        },
      ]),
    );
  });

  it("keeps an item refused on the contract failed until the app changes, then sends it", async () => {
    setClientVersion(OLD_BUILD);

    request.mockRejectedValueOnce(
      new ApiError("Rota não encontrada.", 404, "Not Found", "HTTP", "ROUTE_NOT_FOUND"),
    );

    await outbox.processOutbox();

    expect(stored()[0]).toMatchObject({ status: "failed", failure: "contract" });

    // Same build, next launch: still failed, still visible, not resent.
    await outbox.loadOutbox();
    expect(stored()[0].status).toBe("failed");
    expect(request).toHaveBeenCalledTimes(1);

    // The update lands: it goes out again, by itself.
    setClientVersion(NEW_BUILD);
    request.mockResolvedValueOnce({});

    await outbox.processOutbox();

    expect(request).toHaveBeenCalledTimes(2);
    expect(stored()).toEqual([]);
  });

  it("leaves an item refused on the merits for the driver, update or not", async () => {
    setClientVersion(OLD_BUILD);

    request.mockRejectedValueOnce(
      new ApiError("Entrega já concluída.", 400, "Bad Request", "HTTP", "INVALID_STATUS_TRANSITION"),
    );

    await outbox.processOutbox();

    setClientVersion(NEW_BUILD);
    await outbox.processOutbox();

    expect(request).toHaveBeenCalledTimes(1);
    expect(stored()[0]).toMatchObject({ status: "failed", failure: "permanent" });
  });

  it("stamps what it queues with the shape and the build that wrote it", async () => {
    setClientVersion(NEW_BUILD);
    disk.clear();

    await outbox.enqueueSubmission({
      id: "arrival-1",
      kind: "delivery-arrival",
      businessId: "business-1",
      endpoint: "/delivery/arrival/d/business/business-1",
      body: { client_submission_id: "arrival-1" },
      uploadType: "deliveryPhotos",
      photoField: "photo",
      photos: [],
    });

    expect(stored()[0]).toMatchObject({
      schemaVersion: 1,
      appVersion: expect.stringContaining("ota-b"),
    });
  });
});
