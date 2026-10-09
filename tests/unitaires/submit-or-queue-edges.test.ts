import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";

/**
 * `submitOrQueue` edges left alive by the 06/10 mutation run: the request the
 * record itself goes out as, and a session change under a send that never had
 * an owner. Same harness as submit-or-queue.test.ts: the real upload and
 * submit, only the network edges and the queue's storage are fakes.
 */

const uploadAsync = vi.fn();

vi.mock("expo-file-system/legacy", () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: (...args: unknown[]) => uploadAsync(...args),
}));

type RequestConfig = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

const request = vi.fn<[string, RequestConfig?], Promise<unknown>>();

vi.mock("@/utils/api", async () => {
  const { ApiError: RealApiError } = await vi.importActual<typeof import("@/utils/api-error")>(
    "@/utils/api-error",
  );

  return {
    ApiError: RealApiError,
    apiClient: {
      request: (endpoint: string, config?: RequestConfig) => request(endpoint, config),
      post: (endpoint: string, body?: unknown) => request(endpoint, { method: "POST", body }),
    },
  };
});

const enqueueSubmission = vi.fn(async (input: unknown) => input);

vi.mock("@/features/submissions/outbox", () => ({
  enqueueSubmission: (input: unknown) => enqueueSubmission(input),
  buildPhotoPayload: (_field: string, body: Record<string, unknown>, uploaded: unknown[]) => ({
    ...body,
    photos: uploaded,
  }),
  describeFailure: (error: unknown) =>
    error instanceof ApiError
      ? {
          source: "api",
          isAuthenticationError: error.isAuthenticationError,
          isTransient: error.isTransient,
          code: error.code,
        }
      : { source: "unknown" },
}));

let persistenceEpoch = 0;

vi.mock("@/features/submissions/submission-id", () => ({
  getSubmissionPersistenceEpoch: () => persistenceEpoch,
  holdSubmissionDrafts: () => () => undefined,
}));

const { submitOrQueue } = await import("@/features/submissions/submit-or-queue");

const PRESIGN = "/uploads/presign/business-1";
const ENDPOINT = "/vehicle-checklist/create-vehicle-checklist/business-1";

const submit = () =>
  submitOrQueue({
    submissionId: "submission-1",
    kind: "checklist",
    endpoint: ENDPOINT,
    body: { current_mileage: 1000 },
    businessId: "business-1",
    vehicleId: "vehicle-1",
    entries: [
      { file: { uri: "file:///a.jpg", fileName: "a.jpg", fileSize: 1024, mimeType: "image/jpeg" }, fieldName: "pneus" },
    ],
    uploadType: "checklistPhotos",
    photoField: "photos",
  });

beforeEach(() => {
  uploadAsync.mockReset();
  request.mockReset();
  enqueueSubmission.mockClear();
  persistenceEpoch = 0;

  uploadAsync.mockResolvedValue({ status: 200 });
});

const presignThen = (record: (config?: RequestConfig) => Promise<unknown>) =>
  request.mockImplementation(async (endpoint, config) =>
    endpoint === PRESIGN
      ? { uploads: [{ key: "k1", uploadUrl: "https://s3/u1", expiresIn: 60 }] }
      : record(config),
  );

describe("submitOrQueue", () => {
  it("posts the record with its idempotency key", async () => {
    setSubmissionOwner("user-a");
    presignThen(async () => ({ id: "created" }));

    await expect(submit()).resolves.toBe("sent");

    const [endpoint, config] = request.mock.calls.find(([called]) => called === ENDPOINT) ?? [];
    expect(endpoint).toBe(ENDPOINT);
    expect(config?.method).toBe("POST");
    expect(config?.headers?.["Idempotency-Key"]).toBe("submission-1");
    expect(config?.body).toMatchObject({ current_mileage: 1000 });
  });

  it("hands back a refusal of a send that never had an owner, even if a session changed meanwhile", async () => {
    setSubmissionOwner(null);
    presignThen(async () => {
      persistenceEpoch += 1;
      throw new ApiError("Quilometragem inválida", 400, "Bad Request");
    });

    await expect(submit()).rejects.toMatchObject({ status: 400 });
    expect(enqueueSubmission).not.toHaveBeenCalled();
  });
});
