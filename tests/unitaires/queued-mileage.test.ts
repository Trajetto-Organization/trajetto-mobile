import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setSubmissionOwner } from "@/features/submissions/submission-owner";

/**
 * A reading that is queued still counts on the phone (GAP5-10).
 *
 * The fueling and checklist forms refuse a mileage that is not above the
 * vehicle's, and they read the vehicle from the cache. Online, a submission
 * that lands moves the vehicle forward and the next form sees it. Queued
 * without signal, it did not: a checklist and a fueling filled in at the same
 * stop with the same odometer both passed on the phone, and the second was
 * refused by the API days later — when the form it came from was long gone.
 * Queuing now moves the cached vehicle forward too, never back.
 */

const disk = new Map<string, string>();
const cache = new Map<string, unknown>();

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

  class File {
    uri: string;
    name = "copy.jpg";
    size = 1024;

    constructor(...parts: unknown[]) {
      this.uri = parts.map(String).join("/");
    }

    copy() {}
  }

  return { Directory, File, Paths: { document: "doc" } };
});

vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));

vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    invalidateQueries: async () => undefined,
    setQueryData: (key: unknown[], updater: (old: unknown) => unknown) => {
      const id = JSON.stringify(key);
      cache.set(id, updater(cache.get(id)));
    },
  },
}));

vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: class UploadError extends Error {},
  uploadToStorage: async () => [],
}));

vi.mock("@/utils/api", async () => {
  const { ApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>(
      "@/utils/api-error",
    );

  return { ApiError, apiClient: { request: vi.fn() } };
});

let bumpQueuedMileage: typeof import("@/features/submissions/queue-decision").bumpQueuedMileage;
let outbox: typeof import("@/features/submissions/outbox");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);

  ({ bumpQueuedMileage } = await import("@/features/submissions/queue-decision"));
  outbox = await import("@/features/submissions/outbox");
});

const VEHICLE_KEY = JSON.stringify(["vehicle", "business-1", "vehicle-1"]);

beforeEach(() => {
  disk.clear();
  cache.clear();
  setSubmissionOwner("user-a");
});

describe("bumpQueuedMileage", () => {
  it("raises a lower cached reading to the queued one", () => {
    expect(
      bumpQueuedMileage({ id: "vehicle-1", current_mileage: 10_000 }, 10_300),
    ).toEqual({ id: "vehicle-1", current_mileage: 10_300 });
  });

  it("never lowers it", () => {
    const vehicle = { id: "vehicle-1", current_mileage: 10_500 };

    expect(bumpQueuedMileage(vehicle, 10_300)).toBe(vehicle);
  });

  it("leaves a vehicle that is not cached, and a reading that is not a number, alone", () => {
    expect(bumpQueuedMileage(undefined, 10_300)).toBeUndefined();

    const vehicle = { id: "vehicle-1", current_mileage: 10_000 };
    expect(bumpQueuedMileage(vehicle, Number.NaN)).toBe(vehicle);
  });
});

describe("queuing a checklist", () => {
  it("moves the cached vehicle to the reading it will report", async () => {
    cache.set(VEHICLE_KEY, { id: "vehicle-1", current_mileage: 10_000 });

    await outbox.enqueueSubmission({
      id: "checklist-1",
      kind: "checklist",
      businessId: "business-1",
      vehicleId: "vehicle-1",
      endpoint: "/vehicle-checklist/create-vehicle-checklist/business-1",
      body: { current_mileage: 10_300, client_submission_id: "checklist-1" },
      uploadType: "checklistPhotos",
      photoField: "photos",
      photos: [],
    });

    // The fueling form filled in next, at the same stop, now refuses 10 300.
    expect(cache.get(VEHICLE_KEY)).toEqual({
      id: "vehicle-1",
      current_mileage: 10_300,
    });
  });

  it("does not touch the vehicle for a delivery", async () => {
    cache.set(VEHICLE_KEY, { id: "vehicle-1", current_mileage: 10_000 });

    await outbox.enqueueSubmission({
      id: "arrival-1",
      kind: "delivery-arrival",
      businessId: "business-1",
      endpoint: "/delivery/arrival/d/business/business-1",
      body: { client_submission_id: "arrival-1", current_mileage: 99_999 },
      uploadType: "deliveryPhotos",
      photoField: "photo",
      photos: [],
    });

    expect(cache.get(VEHICLE_KEY)).toEqual({
      id: "vehicle-1",
      current_mileage: 10_000,
    });
  });
});
