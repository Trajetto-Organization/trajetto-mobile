import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setSubmissionOwner } from "@/features/submissions/submission-owner";

/**
 * The first attempt says when it was sent, like every resend does (MOB-08).
 *
 * The API moves the body's `occurred_at` (the tap, by the phone's clock) onto
 * its own clock using `X-Client-Sent-At` (the send, by the same clock). The
 * live send is the common case — a driver with signal — and it has to carry
 * the header too, or a phone whose clock is wrong would record the fact at the
 * wrong hour whenever the network happened to be fine.
 */

vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: class UploadError extends Error {},
  uploadToStorage: async () => [],
}));

type RequestConfig = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

const request = vi.fn(async (_endpoint: string, _config?: RequestConfig) => ({}));

vi.mock("@/utils/api", async () => {
  const { ApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>(
      "@/utils/api-error",
    );

  return {
    ApiError,
    apiClient: {
      request: (endpoint: string, config?: RequestConfig) =>
        request(endpoint, config),
    },
  };
});

vi.mock("@/features/submissions/outbox", () => ({
  enqueueSubmission: async () => undefined,
  buildPhotoPayload: (_field: string, body: Record<string, unknown>) => body,
  describeFailure: () => ({ source: "unknown" }),
}));

vi.mock("@/features/submissions/submission-id", () => ({
  getSubmissionPersistenceEpoch: () => 0,
  holdSubmissionDrafts: () => () => undefined,
}));

const { submitOrQueue } = await import(
  "@/features/submissions/submit-or-queue"
);

const NOW = new Date("2026-09-24T13:40:00.000Z");

beforeEach(() => {
  request.mockClear();
  setSubmissionOwner("user-a");

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a driver action sent with signal", () => {
  it("carries X-Client-Sent-At next to the idempotency key", async () => {
    const outcome = await submitOrQueue({
      submissionId: "submission-1",
      kind: "delivery-arrival",
      endpoint: "/delivery/arrival/delivery-1/business/business-1",
      body: {
        client_submission_id: "submission-1",
        occurred_at: "2026-09-24T13:39:58.000Z",
      },
      businessId: "business-1",
      entries: [],
      uploadType: "deliveryPhotos",
      photoField: "photo",
    });

    expect(outcome).toBe("sent");

    const [, config] = request.mock.calls[0];

    expect(config?.headers).toEqual({
      "Idempotency-Key": "submission-1",
      "X-Client-Sent-At": NOW.toISOString(),
    });
  });
});
