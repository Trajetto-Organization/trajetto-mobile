import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OBS-12: a photo the bucket refused left no trace anyone could read. The
 * UploadError dropped the HTTP status of the PUT, so even the driver's pending
 * screen could not tell a dead signal from a refused signature (403
 * SignatureDoesNotMatch — a credential rotated wrong), and the queue's
 * telemetry said only "transient". The status and the storage HOST (never the
 * signed URL) now travel with the error and with the report.
 */
const uploadAsync = vi.fn();

vi.mock("expo-file-system/legacy", () => ({
  uploadAsync: (...args: unknown[]) => uploadAsync(...args),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));

const request = vi.fn();

vi.mock("@/utils/api", () => ({ apiClient: { request } }));

const SIGNED_URL =
  "https://acc.r2.cloudflarestorage.com/trajetto/deliveryPhotos/b/1.jpg?X-Amz-Signature=segredo";

let storage: typeof import("@/features/media/upload-to-storage");

beforeAll(async () => {
  storage = await import("@/features/media/upload-to-storage");
});

beforeEach(() => {
  uploadAsync.mockReset();
  request.mockReset();

  request.mockResolvedValue({
    uploads: [{ key: "deliveryPhotos/b/1.jpg", uploadUrl: SIGNED_URL, expiresIn: 300 }],
  });
});

describe("a PUT the bucket refused", () => {
  it("says which status and which host, and nothing of the signature", async () => {
    uploadAsync.mockResolvedValue({ status: 403, body: "SignatureDoesNotMatch" });

    const failure = await storage
      .uploadToStorage({
        entries: [
          { file: { uri: "file:///1.jpg", fileSize: 1024, mimeType: "image/jpeg" } },
        ],
        uploadType: "deliveryPhotos",
        businessId: "b",
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(storage.UploadError);
    expect(failure).toMatchObject({
      status: 403,
      host: "acc.r2.cloudflarestorage.com",
    });

    // The message is what the driver reads: unchanged.
    expect((failure as Error).message).toBe(
      "Falha ao enviar uma das fotos. Verifique sua conexão e tente novamente.",
    );
    expect(JSON.stringify(failure)).not.toContain("segredo");
  });
});
