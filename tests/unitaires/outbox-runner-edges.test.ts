import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";
import { useConnectionStore } from "@/store/connection-store";
import { useOutboxStore } from "@/store/outbox-store";

/**
 * The queue runner's edges left alive by the 06/10 mutation run, on the real
 * `outbox.ts` (same harness as outbox-runner.test.ts: an in-memory disk and
 * file tree, a fake API; the stores are the real ones):
 *
 * - what a failure leaves on the item (reupload bookkeeping, and the failure
 *   stamps only on a failed item);
 * - what a landed item invalidates and deletes;
 * - what `enqueueSubmission` writes (owner, replacement, photo defaults, the
 *   mileage hint);
 * - the user actions (discard, revise) and the passes that must NOT run.
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

const fs = vi.hoisted(() => ({
  existing: new Set<string>(),
  deleted: [] as string[],
  created: [] as unknown[],
  sizes: new Map<string, number>(),
}));

vi.mock("expo-file-system", () => {
  const join = (parts: unknown[]) =>
    parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");

  class Directory {
    readonly uri: string;

    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }

    get exists() {
      return fs.existing.has(this.uri);
    }

    create(options: unknown) {
      fs.created.push(options);
    }

    delete() {
      fs.deleted.push(this.uri);
    }
  }

  class File {
    readonly uri: string;

    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }

    get name() {
      return this.uri.split("/").pop() ?? "";
    }

    get size() {
      return fs.sizes.get(this.uri);
    }

    copy() {}
  }

  return { Directory, File, Paths: { document: "doc" } };
});

vi.mock("expo-crypto", () => ({ randomUUID: () => "copy" }));

const query = vi.hoisted(() => ({ invalidated: [] as unknown[], setData: [] as unknown[] }));

vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    invalidateQueries: async ({ queryKey }: { queryKey: unknown }) => void query.invalidated.push(queryKey),
    setQueryData: (queryKey: unknown) => void query.setData.push(queryKey),
  },
}));

vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: class UploadError extends Error {},
  // Photos not yet in storage are "uploaded" here and reported one by one,
  // like the real upload does before the record itself is sent.
  uploadToStorage: async ({
    entries,
    onUploaded,
  }: {
    entries: { uploadedKey?: string; fieldName?: string }[];
    onUploaded?: (index: number, key: string) => void;
  }) =>
    entries.map((entry, index) => {
      if (entry.uploadedKey) return { key: entry.uploadedKey, fieldName: entry.fieldName };
      onUploaded?.(index, `fresh-key-${index}`);
      return { key: `fresh-key-${index}`, fieldName: entry.fieldName };
    }),
}));

type Sent = { endpoint: string; method?: string; body: Record<string, unknown> };

const sent: Sent[] = [];
const request = vi.fn();

vi.mock("@/utils/api", async () => {
  const { ApiError: RealApiError } = await vi.importActual<typeof import("@/utils/api-error")>(
    "@/utils/api-error",
  );

  return {
    ApiError: RealApiError,
    apiClient: {
      request: async (endpoint: string, config: { method?: string; body: Record<string, unknown> }) => {
        sent.push({ endpoint, method: config.method, body: config.body });
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

const onDisk = (): Array<Record<string, unknown>> => JSON.parse(disk.get(STORAGE_KEY) ?? "[]");
const store = (items: unknown[]) => disk.set(STORAGE_KEY, JSON.stringify(items));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  disk.clear();
  sent.length = 0;
  request.mockReset();
  request.mockResolvedValue({ id: "row" });
  query.invalidated.length = 0;
  query.setData.length = 0;
  fs.existing.clear();
  fs.deleted.length = 0;
  fs.created.length = 0;
  fs.sizes.clear();
  useConnectionStore.getState().setDeviceOffline(false);
  setSubmissionOwner("user-a");
});

describe("a failed send", () => {
  it("forgets the stored photo and counts a reupload when storage lost the file", async () => {
    store([queued("fuel-1")]);
    request.mockRejectedValueOnce(
      new ApiError("Arquivo não encontrado", 400, "Bad Request", "HTTP", "UPLOADED_FILE_NOT_FOUND"),
    );

    await outbox.processOutbox();

    const [item] = onDisk() as Array<{ photos: { uploadedKey?: string }[]; reuploads?: number; status: string }>;
    expect(item.photos[0].uploadedKey).toBeUndefined();
    expect(item.reuploads).toBe(1);
  });

  it("keeps the uploads and stamps nothing on a transient failure", async () => {
    store([queued("fuel-1", { reuploads: 2 })]);
    request.mockRejectedValueOnce(new ApiError("Network request failed", 0, "Network Error", "NETWORK", "NET_DOWN"));

    await outbox.processOutbox();

    const [item] = onDisk();
    expect(item).toMatchObject({ status: "pending", attempts: 1, reuploads: 2 });
    expect((item.photos as { uploadedKey?: string }[])[0].uploadedKey).toBe("odometerPhotos/business-1/fuel-1.jpg");
    expect(item.parkedAt).toBeUndefined();
    expect(item.failure).toBeUndefined();
    expect(item.failureCode).toBeUndefined();
  });

  it("stamps the refusal's kind and code on a failed item", async () => {
    store([queued("fuel-1")]);
    request.mockRejectedValueOnce(new ApiError("Quilometragem inválida", 400, "Bad Request", "HTTP", "MILEAGE_INVALID"));

    await outbox.processOutbox();

    expect(onDisk()[0]).toMatchObject({ status: "failed", failure: "permanent", failureCode: "MILEAGE_INVALID" });
  });
});

describe("describeFailure", () => {
  it("names an upload failure and anything else", async () => {
    const { UploadError } = await import("@/features/media/upload-to-storage");

    expect(outbox.describeFailure(new UploadError("PUT refused"))).toEqual({ source: "upload" });
    expect(outbox.describeFailure(new Error("boom"))).toEqual({ source: "unknown" });
  });
});

describe("a send that fails after its photos went up", () => {
  it("keeps each uploaded key on the item, so the retry does not upload again", async () => {
    const photo = { uri: "file:///p.jpg", fileName: "p.jpg", fileSize: 1, mimeType: "image/jpeg" };
    store([queued("fuel-1", { photos: [{ ...photo, uploadedKey: "kept" }, photo] })]);
    request.mockRejectedValueOnce(new ApiError("Network request failed", 0, "Network Error", "NETWORK"));

    await outbox.processOutbox();
    await flush();

    expect((onDisk()[0].photos as { uploadedKey?: string }[]).map((entry) => entry.uploadedKey)).toEqual([
      "kept",
      "fresh-key-1",
    ]);
  });

  it("records what was thrown when it is not an Error", async () => {
    store([queued("fuel-1")]);
    request.mockRejectedValueOnce("socket closed");

    await outbox.processOutbox();

    expect(onDisk()[0].lastError).toBe("Falha ao enviar o registro.");
  });
});

describe("an expired departure", () => {
  it("fails for good with the expiry message instead of being sent", async () => {
    store([
      queued("start-1", {
        kind: "delivery-start-route",
        endpoint: "/delivery/start-route/business-1",
        photos: [],
        createdAt: new Date(Date.now() - 13 * 3_600_000).toISOString(),
      }),
    ]);

    await outbox.processOutbox();

    expect(sent).toEqual([]);
    expect(onDisk()[0]).toMatchObject({ status: "failed", failure: "permanent" });
    expect(String(onDisk()[0].lastError)).toMatch(/^Início de rota expirado/);
  });
});

describe("the pass on the store", () => {
  it("is shown while it sends, with the item and its progress, and cleared after", async () => {
    store([queued("fuel-1")]);
    let during: unknown = null;
    request.mockImplementationOnce(async () => {
      const state = useOutboxStore.getState();
      during = { processing: state.isProcessing, active: state.activeItemId, progress: state.activeProgress };
      return { id: "row" };
    });

    await outbox.processOutbox();

    expect(during).toEqual({ processing: true, active: "fuel-1", progress: { uploaded: 0, total: 1 } });
    const after = useOutboxStore.getState();
    expect([after.isProcessing, after.activeItemId, after.activeProgress]).toEqual([false, null, null]);
  });
});

describe("a landed send", () => {
  it("is a POST, and refreshes the vehicle lists of a fleet record", async () => {
    store([queued("fuel-1")]);

    await outbox.processOutbox();
    await flush();

    expect(sent[0].method).toBe("POST");
    expect(query.invalidated).toEqual([
      ["vehicles", "business-1"],
      ["vehicle", "business-1", "vehicle-1"],
    ]);
  });

  it("refreshes the day's deliveries for a delivery record", async () => {
    store([queued("arrival-1", { kind: "delivery-arrival", endpoint: "/delivery/arrival/d1/business-1", photos: [] })]);

    await outbox.processOutbox();
    await flush();

    expect(query.invalidated).toEqual([["my-deliveries", "business-1"]]);
  });

  it("deletes the item's photo directory when there is one", async () => {
    fs.existing.add("doc/trajetto-outbox/fuel-1");
    store([queued("fuel-1")]);

    await outbox.processOutbox();

    expect(fs.deleted).toEqual(["doc/trajetto-outbox/fuel-1"]);
  });
});

describe("passes that must not run", () => {
  it("skips the pass while the phone's radio is off", async () => {
    useConnectionStore.getState().setDeviceOffline(true);
    store([queued("fuel-1")]);

    await outbox.processOutbox();

    expect(sent).toEqual([]);
  });

  it("does not start a pass when nothing was unparked", async () => {
    store([queued("fuel-1")]);

    await outbox.unparkOutboxItems();

    expect(sent).toEqual([]);
  });

  it("does not send after a revision that changed nothing", async () => {
    // Another item is due: a pass started anyway would send it.
    store([queued("fuel-1", { nextAttemptAt: Date.now() + 3_600_000 }), queued("fuel-2")]);

    await expect(outbox.reviseOutboxItem("fuel-1", { current_mileage: 2 })).resolves.toBe(false);
    await flush();

    expect(sent).toEqual([]);
  });

  it("sends a revised failed item right away", async () => {
    store([queued("fuel-1", { status: "failed", nextAttemptAt: Date.now() + 3_600_000 })]);

    await expect(outbox.reviseOutboxItem("fuel-1", { current_mileage: 2 })).resolves.toBe(true);
    await flush();
    await flush();

    expect(sent.map((attempt) => attempt.body.current_mileage)).toEqual([2]);
  });
});

describe("discardOutboxItem", () => {
  it("removes the driver's own item, and only that one", async () => {
    store([queued("fuel-1"), queued("fuel-2")]);

    await outbox.discardOutboxItem("fuel-2");

    expect(onDisk().map((item) => item.id)).toEqual(["fuel-1"]);
  });

  it("leaves another driver's item and an unknown id alone", async () => {
    // The driver's own item first: the check must be on the item named.
    store([queued("fuel-a"), queued("fuel-b", { ownerUserId: "user-b" })]);

    await outbox.discardOutboxItem("fuel-b");
    await outbox.discardOutboxItem("missing");

    expect(onDisk().map((item) => item.id)).toEqual(["fuel-a", "fuel-b"]);
  });
});

describe("enqueueSubmission", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    id: "sub-1",
    kind: "checklist" as const,
    businessId: "business-1",
    vehicleId: "vehicle-1",
    endpoint: "/vehicle-checklist/create-vehicle-checklist/business-1",
    body: { current_mileage: 1500 },
    uploadType: "checklistPhotos" as const,
    photoField: "photos" as const,
    photos: [] as Array<Record<string, unknown>>,
    ...overrides,
  });

  it("creates the item's directory idempotently, with its parents", async () => {
    await outbox.enqueueSubmission(input() as never);

    expect(fs.created).toEqual([{ intermediates: true, idempotent: true }]);
  });

  it("stamps the session's owner, or the one the caller captured", async () => {
    expect((await outbox.enqueueSubmission(input() as never)).ownerUserId).toBe("user-a");
    expect((await outbox.enqueueSubmission(input({ id: "sub-2", ownerUserId: "user-b" }) as never)).ownerUserId).toBe(
      "user-b",
    );
  });

  it("replaces a queued attempt with the same key instead of stacking it", async () => {
    await outbox.enqueueSubmission(input({ body: { current_mileage: 1 } }) as never);
    await outbox.enqueueSubmission(input({ body: { current_mileage: 2 } }) as never);

    expect(onDisk().map((item) => (item.body as { current_mileage: number }).current_mileage)).toEqual([2]);
  });

  it("keeps the other queued items when it adds one", async () => {
    await outbox.enqueueSubmission(input({ id: "sub-1" }) as never);
    await outbox.enqueueSubmission(input({ id: "sub-2" }) as never);

    expect(onDisk().map((item) => item.id)).toEqual(["sub-1", "sub-2"]);
  });

  it("fills a photo's missing name, size and type", async () => {
    const item = await outbox.enqueueSubmission(
      input({
        photos: [
          { uri: "file:///a.jpg", fileName: "", mimeType: null },
          { uri: "file:///b.jpg", fileName: "b.jpg", fileSize: 77, mimeType: "image/png" },
        ],
      }) as never,
    );

    expect(item.photos.map(({ fileName, fileSize, mimeType }) => ({ fileName, fileSize, mimeType }))).toEqual([
      { fileName: "copy.jpg", fileSize: 0, mimeType: "image/jpeg" },
      { fileName: "b.jpg", fileSize: 77, mimeType: "image/png" },
    ]);
  });

  it("takes the copied file's own size over the one reported", async () => {
    fs.sizes.set("doc/trajetto-outbox/sub-1/copy.jpg", 2048);

    const item = await outbox.enqueueSubmission(
      input({ photos: [{ uri: "file:///a.jpg", fileName: "a.jpg", fileSize: 10 }] }) as never,
    );

    expect(item.photos[0].fileSize).toBe(2048);
  });

  it("only hints the vehicle's mileage for fleet records of a vehicle", async () => {
    await outbox.enqueueSubmission(input() as never);
    await outbox.enqueueSubmission(input({ id: "fuel-1", kind: "fuel" }) as never);
    expect(query.setData).toEqual([
      ["vehicle", "business-1", "vehicle-1"],
      ["vehicle", "business-1", "vehicle-1"],
    ]);

    query.setData.length = 0;
    await outbox.enqueueSubmission(input({ id: "d-1", kind: "delivery-arrival" }) as never);
    await outbox.enqueueSubmission(input({ id: "c-2", vehicleId: undefined }) as never);
    expect(query.setData).toEqual([]);
  });
});

describe("detachOutbox", () => {
  it("empties the session's view of the queue", async () => {
    store([queued("fuel-1", { nextAttemptAt: Date.now() + 3_600_000 })]);
    await outbox.loadOutbox();
    expect(useOutboxStore.getState().items).toHaveLength(1);

    outbox.detachOutbox();

    expect(useOutboxStore.getState().items).toEqual([]);
  });
});
