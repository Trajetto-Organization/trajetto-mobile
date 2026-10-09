import { beforeEach, describe, expect, it, vi } from "vitest";

import { setSubmissionOwner } from "@/features/submissions/submission-owner";

/**
 * A submission sent at the tap hands the API's answer to its kind
 * (`onSent`): "a caminho" keeps the instant the API recorded, as the queue
 * does for a later send (kind-effects). The effect is best-effort — a throw
 * in it must never turn a record that landed into a queued or refused one.
 */

vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: class UploadError extends Error {},
  uploadToStorage: async () => [],
}));

const request = vi.fn(async (_endpoint: string, _config?: unknown): Promise<unknown> => ({}));

vi.mock("@/utils/api", async () => {
  const { ApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>("@/utils/api-error");

  return {
    ApiError,
    apiClient: { request: (endpoint: string, config?: unknown) => request(endpoint, config) },
  };
});

const enqueueSubmission = vi.fn(async () => undefined);

vi.mock("@/features/submissions/outbox", () => ({
  enqueueSubmission: () => enqueueSubmission(),
  buildPhotoPayload: (_field: string, body: Record<string, unknown>) => body,
  describeFailure: () => ({ source: "unknown" }),
}));

vi.mock("@/features/submissions/submission-id", () => ({
  getSubmissionPersistenceEpoch: () => 0,
  holdSubmissionDrafts: () => () => undefined,
}));

const { submitOrQueue } = await import("@/features/submissions/submit-or-queue");

const input = {
  submissionId: "submission-1",
  kind: "delivery-on-the-way" as const,
  endpoint: "/route/on-the-way/stop-1/route/route-1/business/business-1",
  body: { client_submission_id: "submission-1", occurred_at: "2026-09-29T15:02:00.000Z" },
  businessId: "business-1",
  entries: [],
  uploadType: "deliveryPhotos" as const,
  photoField: "photo" as const,
};

beforeEach(() => {
  request.mockClear();
  enqueueSubmission.mockClear();
  setSubmissionOwner("user-a");
});

describe("a submission sent at the tap", () => {
  it("hands the API's answer to its kind", async () => {
    const answer = { data: { on_the_way_at: "2026-09-29T15:02:07.000Z" } };
    request.mockResolvedValueOnce(answer);

    const onSent = vi.fn();

    await expect(submitOrQueue({ ...input, onSent })).resolves.toBe("sent");
    expect(onSent).toHaveBeenCalledWith(answer);
  });

  it("stays sent when the effect throws: nothing is queued twice", async () => {
    const onSent = vi.fn(async () => {
      throw new Error("disk full");
    });

    await expect(submitOrQueue({ ...input, onSent })).resolves.toBe("sent");
    expect(enqueueSubmission).not.toHaveBeenCalled();
  });
});
