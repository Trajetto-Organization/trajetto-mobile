import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setSubmissionOwner } from "@/features/submissions/submission-owner";

/**
 * OBS-12: a proof whose photos the bucket keeps refusing never becomes
 * "failed" — an upload failure is transient by rule, so the item stays
 * pending and is retried every few minutes, forever. The queue does tell the
 * telemetry once it has tried three times (MOB-10); what it told was only
 * "transient". It now says it was the UPLOAD, with the PUT's status and the
 * storage host, which is what tells a rotated credential (403) from a phone
 * with no signal.
 */
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

const upload = vi.hoisted(() => ({
  UploadError: class UploadError extends Error {
    readonly status?: number;
    readonly host?: string;

    constructor(message: string, details: { status?: number; host?: string } = {}) {
      super(message);
      this.name = "UploadError";
      this.status = details.status;
      this.host = details.host;
    }
  },
}));

const uploadToStorage = vi.fn();

vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: upload.UploadError,
  uploadToStorage: (...args: unknown[]) => uploadToStorage(...args),
}));

vi.mock("@/utils/api", async () => {
  const { ApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>("@/utils/api-error");

  return { ApiError, apiClient: { request: vi.fn() } };
});

let outbox: typeof import("@/features/submissions/outbox");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
});

beforeEach(() => {
  disk.clear();
  setSubmissionOwner("user-a");

  disk.set(
    "@trajetto:outbox:v1",
    JSON.stringify([
      {
        id: "item-1",
        kind: "delivery-proof",
        businessId: "business-1",
        ownerUserId: "user-a",
        endpoint: "/delivery/proof/business-1",
        body: {},
        photos: [],
        uploadType: "deliveryPhotos",
        photoField: "photos",
        createdAt: new Date(0).toISOString(),
        // Two attempts already: the next failure is the third.
        attempts: 2,
        nextAttemptAt: 0,
        status: "pending",
      },
    ]),
  );
});

describe("an upload the bucket keeps refusing", () => {
  it("is reported as an upload, with the PUT's status and host", async () => {
    const { setTelemetrySink } = await import("@/utils/telemetry");
    const sink = vi.fn();
    setTelemetrySink(sink);

    uploadToStorage.mockRejectedValue(
      new upload.UploadError("Falha ao enviar uma das fotos.", {
        status: 403,
        host: "acc.r2.cloudflarestorage.com",
      }),
    );

    await outbox.processOutbox();

    const [item] = JSON.parse(disk.get("@trajetto:outbox:v1") ?? "[]");
    expect(item.status).toBe("pending");

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "outbox_item_failed",
        tags: expect.objectContaining({
          kind: "delivery-proof",
          failure: "transient",
          source: "upload",
          status: 403,
          host: "acc.r2.cloudflarestorage.com",
        }),
      }),
    );
  });
});
