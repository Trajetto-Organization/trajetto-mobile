import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";
import { shouldUnpark } from "@/features/submissions/outbox-rules";
import { observeEnabledModules } from "@/features/access/module-observations";

/**
 * Submissions parked because the company switched a module off (MOB-03).
 *
 * They used to go back in line whenever the deliveries list loaded: a
 * refuelling in a company with Entregas on and Gestão de Frota off was
 * refused, parked, unparked and refused again, one POST per turn while the
 * app was open; in a company with only Gestão de Frota the list never loaded
 * and the item stayed parked forever, even after the module came back.
 *
 * These run the real `outbox.ts` over an in-memory disk and a fake API, like
 * outbox-runner.test.ts.
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

const sent: Array<{ endpoint: string; id: unknown }> = [];
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
        config: { body: Record<string, unknown> },
      ) => {
        sent.push({ endpoint, id: config.body.client_submission_id });
        return request(endpoint, config);
      },
    },
  };
});

const STORAGE_KEY = "@trajetto:outbox:v1";

let outbox: typeof import("@/features/submissions/outbox");
let store: typeof import("@/store/outbox-store");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
  store = await import("@/store/outbox-store");
});

function queued(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind: "fuel",
    businessId: "business-1",
    ownerUserId: "user-a",
    vehicleId: "vehicle-1",
    endpoint: "/fuel/create-fuel/business-1",
    body: { client_submission_id: id },
    photos: [],
    uploadType: "odometerPhotos",
    photoField: "photo",
    createdAt: new Date(0).toISOString(),
    attempts: 0,
    nextAttemptAt: 0,
    status: "pending",
    ...overrides,
  };
}

const parked = (id: string, overrides: Record<string, unknown> = {}) =>
  queued(id, { status: "parked", parkedAt: 1_000, ...overrides });

const onDisk = (): Array<Record<string, unknown>> =>
  JSON.parse(disk.get(STORAGE_KEY) ?? "[]");

const moduleOff = () =>
  new ApiError(
    "Este módulo não está habilitado para a sua empresa.",
    403,
    "Forbidden",
    "HTTP",
    "MODULE_NOT_ENABLED",
  );

beforeEach(() => {
  disk.clear();
  sent.length = 0;
  request.mockReset();
  vi.restoreAllMocks();

  // Each test is a fresh session: observations are per session.
  outbox.detachOutbox();
  setSubmissionOwner("user-a");
});

describe("a refuelling refused because Gestão de Frota is off", () => {
  it("is parked once and not sent again however often the queue is poked", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([queued("fuel-1")]));
    request.mockRejectedValue(moduleOff());

    await outbox.processOutbox();

    expect(sent).toHaveLength(1);
    expect(onDisk()[0]).toMatchObject({ status: "parked" });
    expect(typeof onDisk()[0].parkedAt).toBe("number");

    // What the deliveries list used to do on every success while an item was
    // parked: each call was one more refused POST.
    for (let turn = 0; turn < 5; turn += 1) {
      await outbox.unparkOutboxItems();
    }

    expect(sent).toHaveLength(1);
    expect(onDisk()[0]).toMatchObject({ status: "parked" });
  });

  it("is not sent when the server only says Entregas is on", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([parked("fuel-1")]));

    await observeEnabledModules({
      businessId: "business-1",
      enabledModules: ["DELIVERIES"],
      observedAt: 5_000,
    });

    expect(sent).toHaveLength(0);
    expect(onDisk()[0]).toMatchObject({ status: "parked" });
  });

  it("goes out once the server says Gestão de Frota is back, with no Entregas at all", async () => {
    // The company that only ever had the fleet: nothing about deliveries
    // will ever load there, and the item used to stay parked for good.
    disk.set(STORAGE_KEY, JSON.stringify([parked("fuel-1")]));
    request.mockResolvedValue({ id: "fuel-row" });

    await observeEnabledModules({
      businessId: "business-1",
      enabledModules: ["FLEET"],
      observedAt: 5_000,
    });

    expect(sent.map((attempt) => attempt.id)).toEqual(["fuel-1"]);
    expect(onDisk()).toEqual([]);
  });

  it("gets one attempt per new word from the server, not a loop", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([queued("fuel-1")]));
    request.mockRejectedValue(moduleOff());

    // The server said FLEET is on (a stale plan somewhere), then refused.
    await observeEnabledModules({
      businessId: "business-1",
      enabledModules: ["FLEET"],
      observedAt: Date.now() - 60_000,
    });
    await outbox.processOutbox();

    expect(sent).toHaveLength(1);

    // The old word is older than the refusal: it buys nothing.
    await outbox.unparkOutboxItems();
    expect(sent).toHaveLength(1);

    // A newer one buys exactly one more try.
    const newerWord = Date.now() + 60_000;

    await observeEnabledModules({
      businessId: "business-1",
      enabledModules: ["FLEET"],
      observedAt: newerWord,
    });
    expect(sent).toHaveLength(2);

    // And repeating that same word (two screens reading one cached answer)
    // buys nothing more.
    await observeEnabledModules({
      businessId: "business-1",
      enabledModules: ["FLEET"],
      observedAt: newerWord,
    });
    expect(sent).toHaveLength(2);
  });
});

describe("the module that comes back", () => {
  it("frees only the submissions that need it", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        parked("fuel-1"),
        parked("proof-1", {
          kind: "delivery-proof",
          endpoint: "/delivery/proof/delivery-1",
          vehicleId: undefined,
        }),
      ]),
    );
    request.mockResolvedValue({});

    await observeEnabledModules({
      businessId: "business-1",
      enabledModules: ["DELIVERIES"],
      observedAt: 5_000,
    });

    expect(sent.map((attempt) => attempt.id)).toEqual(["proof-1"]);
    expect(onDisk()).toEqual([expect.objectContaining({ id: "fuel-1", status: "parked" })]);
  });

  it("of another company frees nothing of this one", async () => {
    // A MASTER's queue can hold items of several companies.
    disk.set(STORAGE_KEY, JSON.stringify([parked("fuel-1")]));

    await observeEnabledModules({
      businessId: "business-2",
      enabledModules: ["FLEET"],
      observedAt: 5_000,
    });

    expect(sent).toHaveLength(0);
  });

  it("frees an item parked by an older build that did not record when", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([parked("fuel-1", { parkedAt: undefined })]));
    request.mockResolvedValue({});

    await observeEnabledModules({
      businessId: "business-1",
      enabledModules: ["FLEET"],
      observedAt: 5_000,
    });

    expect(sent).toHaveLength(1);
  });

  it("never frees someone else's submission", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([parked("fuel-1", { ownerUserId: "user-b" })]),
    );

    await observeEnabledModules({
      businessId: "business-1",
      enabledModules: ["FLEET"],
      observedAt: 5_000,
    });

    expect(sent).toHaveLength(0);
    expect(onDisk()[0]).toMatchObject({ status: "parked", ownerUserId: "user-b" });
  });
});

describe("the driver's own retry", () => {
  it("sends a parked item right away and parks it again with a fresh time", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([parked("fuel-1")]));
    request.mockRejectedValue(moduleOff());

    await outbox.retryOutboxItem("fuel-1");

    expect(sent).toHaveLength(1);
    expect(onDisk()[0]).toMatchObject({ status: "parked" });
    expect(onDisk()[0].parkedAt).toBeGreaterThan(1_000);
  });
});

describe("what the screens count", () => {
  it("counts this driver's parked items, apart from pending and failed", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        parked("fuel-1"),
        parked("fuel-2", { ownerUserId: "user-b" }),
        queued("fuel-3"),
        queued("fuel-4", { status: "failed" }),
      ]),
    );

    await outbox.loadOutbox();

    const state = store.useOutboxStore.getState();

    expect(store.selectParkedCount(state)).toBe(1);
    expect(store.selectPendingCount(state)).toBe(1);
    expect(store.selectFailedCount(state)).toBe(1);

    // Parked needs someone to act (the company), like a failure does.
    expect(store.selectNeedsAttentionCount(state)).toBe(2);
  });
});

describe("the rule", () => {
  it("wants the item's own module on, and said after the refusal", () => {
    const item = { status: "parked" as const, parkedAt: 100 };

    expect(shouldUnpark(item, { enabled: true, observedAt: 101 })).toBe(true);
    expect(shouldUnpark(item, { enabled: true, observedAt: 100 })).toBe(false);
    expect(shouldUnpark(item, { enabled: false, observedAt: 500 })).toBe(false);
    expect(shouldUnpark(item, null)).toBe(false);
    expect(
      shouldUnpark({ status: "pending" }, { enabled: true, observedAt: 500 }),
    ).toBe(false);
  });
});
