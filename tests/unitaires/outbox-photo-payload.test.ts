import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `buildPhotoPayload`, the one place that turns uploaded keys into each
 * endpoint's body. The mutation run (Stryker, 06/10/2026) showed that only the
 * `photos` dialect was pinned: a proof that lost its signature key, or a
 * `photos` body that dropped the field names, passed the suite.
 *
 * The real `outbox.ts` is loaded; only the natives it imports at module load
 * are stubbed (the function itself touches none of them).
 */
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { document: "doc" },
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries: async () => undefined },
}));

vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: class UploadError extends Error {},
  uploadToStorage: async () => [],
}));

vi.mock("@/utils/api", () => ({
  ApiError: class ApiError extends Error {},
  apiClient: { request: async () => undefined },
}));

let outbox: typeof import("@/features/submissions/outbox");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
});

const body = { idempotency_key: "k-1", mileage: 10 };

describe("buildPhotoPayload: each endpoint's dialect", () => {
  it("sends `photos` as key and field name pairs", () => {
    expect(
      outbox.buildPhotoPayload("photos", body, [
        { key: "a", fieldName: "front" },
        { key: "b", fieldName: "back" },
      ]),
    ).toEqual({
      ...body,
      photos: [
        { key: "a", fieldName: "front" },
        { key: "b", fieldName: "back" },
      ],
    });
  });

  it("puts the proof photo and the signature each in its own field", () => {
    expect(
      outbox.buildPhotoPayload("proof", body, [
        { key: "sig", fieldName: "signature" },
        { key: "pic", fieldName: "photo" },
      ]),
    ).toEqual({ ...body, photo: "pic", signature: "sig" });
  });

  it("leaves out the proof fields that were not uploaded", () => {
    expect(
      outbox.buildPhotoPayload("proof", body, [{ key: "pic", fieldName: "photo" }]),
    ).toEqual({ ...body, photo: "pic" });
    expect(
      outbox.buildPhotoPayload("proof", body, [{ key: "sig", fieldName: "signature" }]),
    ).toEqual({ ...body, signature: "sig" });
  });

  it("does not change the caller's body", () => {
    const original = { ...body };

    outbox.buildPhotoPayload("proof", original, [{ key: "pic", fieldName: "photo" }]);

    expect(original).toEqual(body);
  });
});
