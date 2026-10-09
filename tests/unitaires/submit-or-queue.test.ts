import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import {
  getSubmissionOwner,
  setSubmissionOwner,
} from "@/features/submissions/submission-owner";

/**
 * The two ends of a submission that the pure rules cannot see on their own.
 *
 * `queue-decision` decides from a description of the failure; this file checks
 * that `submitOrQueue` describes the failure honestly. Two lies used to slip
 * through:
 *
 * - a driver who discarded the checklist mid-upload got an `UploadError`, not
 *   an abort, so the abandoned inspection was QUEUED and sent on the next
 *   sweep (MOB-06);
 * - a session that ended at the moment of sending made the submission
 *   "rejected", while the logout fired by the same 401 had already deleted the
 *   draft and its photos — the finished work was simply gone (MOB-07).
 *
 * The real `uploadToStorage` runs here; only the network edges are fakes.
 */

const uploadAsync = vi.fn();

vi.mock("expo-file-system/legacy", () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: (...args: unknown[]) => uploadAsync(...args),
}));

type RequestConfig = { method?: string; body?: unknown; signal?: AbortSignal };

const request = vi.fn<[string, RequestConfig?], Promise<unknown>>();

vi.mock("@/utils/api", async () => {
  const { ApiError: RealApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>(
      "@/utils/api-error",
    );

  return {
    ApiError: RealApiError,
    apiClient: {
      request: (endpoint: string, config?: RequestConfig) =>
        request(endpoint, config),
      post: (endpoint: string, body?: unknown) =>
        request(endpoint, { method: "POST", body }),
    },
  };
});

const enqueueSubmission = vi.fn(async (input: unknown) => input);

vi.mock("@/features/submissions/outbox", async () => {
  const { UploadError } = await vi.importActual<
    typeof import("@/features/media/upload-to-storage")
  >("@/features/media/upload-to-storage");

  return {
    enqueueSubmission: (input: unknown) => enqueueSubmission(input),

    buildPhotoPayload: (
      _field: string,
      body: Record<string, unknown>,
      uploaded: unknown[],
    ) => ({ ...body, photos: uploaded }),

    // The real one lives beside AsyncStorage and the filesystem; this is the
    // same three-way mapping.
    describeFailure: (error: unknown) => {
      if (error instanceof ApiError) {
        return {
          source: "api",
          isAuthenticationError: error.isAuthenticationError,
          isTransient: error.isTransient,
          code: error.code,
        };
      }

      if (error instanceof UploadError) return { source: "upload" };

      return { source: "unknown" };
    },
  };
});

// The logout clears drafts and bumps this epoch; the fakes below do both.
let persistenceEpoch = 0;
const heldDrafts = new Set<string>();
const releases: string[] = [];

vi.mock("@/features/submissions/submission-id", () => ({
  getSubmissionPersistenceEpoch: () => persistenceEpoch,
  holdSubmissionDrafts: (submissionId: string) => {
    heldDrafts.add(submissionId);

    return () => {
      heldDrafts.delete(submissionId);
      releases.push(submissionId);
    };
  },
}));

const { submitOrQueue } = await import(
  "@/features/submissions/submit-or-queue"
);

const PRESIGN = "/uploads/presign/business-1";
const ENDPOINT = "/vehicle-checklist/create-vehicle-checklist/business-1";

const photo = (uri: string) => ({
  file: { uri, fileName: "foto.jpg", fileSize: 1024, mimeType: "image/jpeg" },
  fieldName: "pneus",
});

const submit = (signal?: AbortSignal, entries = [photo("file:///a.jpg")]) =>
  submitOrQueue({
    submissionId: "submission-1",
    kind: "checklist",
    endpoint: ENDPOINT,
    body: { current_mileage: 1000 },
    businessId: "business-1",
    vehicleId: "vehicle-1",
    entries,
    uploadType: "checklistPhotos",
    photoField: "photos",
    signal,
  });

/** What `request()` does when a 401 cannot be refreshed: log out, then throw. */
const logOutDuringRequest = () => {
  setSubmissionOwner(null);
  persistenceEpoch += 1;
};

const abortError = (message: string) =>
  Object.assign(new Error(message), { name: "AbortError" });

beforeEach(() => {
  uploadAsync.mockReset();
  request.mockReset();
  enqueueSubmission.mockClear();

  persistenceEpoch = 0;
  heldDrafts.clear();
  releases.length = 0;

  setSubmissionOwner("user-a");

  uploadAsync.mockResolvedValue({ status: 200 });

  request.mockImplementation(async (endpoint, config) => {
    if (config?.signal?.aborted) throw abortError("Request aborted");

    if (endpoint === PRESIGN) {
      return {
        uploads: [{ key: "k1", uploadUrl: "https://s3/u1", expiresIn: 60 }],
      };
    }

    return { id: "created" };
  });
});

describe("a submission the driver abandoned (MOB-06)", () => {
  it("is not queued when the driver discards it while a photo is uploading", async () => {
    const controller = new AbortController();

    // The PUT that was already in flight finishes; the discard lands during it.
    uploadAsync.mockImplementation(async () => {
      controller.abort();
      return { status: 200 };
    });

    await expect(submit(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(enqueueSubmission).not.toHaveBeenCalled();
  });

  it("is not queued when the screen was left before the photos were signed", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(submit(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });

    expect(enqueueSubmission).not.toHaveBeenCalled();
    expect(uploadAsync).not.toHaveBeenCalled();
  });

  it("passes the driver's signal to the presign, so leaving stops it too", async () => {
    const controller = new AbortController();

    await submit(controller.signal);

    const presign = request.mock.calls.find(([endpoint]) => endpoint === PRESIGN);
    expect(presign?.[1]?.signal).toBe(controller.signal);
  });
});

describe("a submission whose session ended while it was being sent (MOB-07)", () => {
  it("is queued under the driver who pressed send, not rejected", async () => {
    request.mockImplementation(async (endpoint) => {
      if (endpoint === PRESIGN) {
        return {
          uploads: [{ key: "k1", uploadUrl: "https://s3/u1", expiresIn: 60 }],
        };
      }

      logOutDuringRequest();
      throw new ApiError(
        "Sessão encerrada",
        401,
        "Unauthorized",
        "HTTP",
        "AUTH_SESSION_INVALIDATED",
      );
    });

    // Distinct from "queued": it goes when this driver signs in again, not
    // when the signal comes back, and the screen has to say so.
    await expect(submit(new AbortController().signal)).resolves.toBe(
      "queued-signed-out",
    );

    expect(getSubmissionOwner()).toBeNull();
    expect(enqueueSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "submission-1",
        ownerUserId: "user-a",
        photos: [expect.objectContaining({ uploadedKey: "k1" })],
      }),
    );
  });

  it("is queued when the presign itself met the dead session", async () => {
    request.mockImplementation(async () => {
      logOutDuringRequest();
      throw new ApiError("Session expired", 401, "Unauthorized");
    });

    await expect(submit()).resolves.toBe("queued-signed-out");

    expect(enqueueSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-a" }),
    );
  });

  it("is queued when the logout aborted it and unmounted the screen", async () => {
    /**
     * Another request's 401 logs out: `invalidateSession` aborts every
     * authenticated request in flight, and the protected screens unmount,
     * which aborts the form's own controller. Neither abort is the driver
     * changing their mind.
     */
    const controller = new AbortController();

    request.mockImplementation(async (endpoint) => {
      if (endpoint === PRESIGN) {
        return {
          uploads: [{ key: "k1", uploadUrl: "https://s3/u1", expiresIn: 60 }],
        };
      }

      logOutDuringRequest();
      controller.abort();
      throw abortError("Session changed during request");
    });

    await expect(submit(controller.signal)).resolves.toBe("queued-signed-out");

    expect(enqueueSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "user-a" }),
    );
  });

  it("keeps the draft photos from the logout's cleanup until the queue has its copy", async () => {
    let heldWhileEnqueueing = false;

    enqueueSubmission.mockImplementationOnce(async (input) => {
      heldWhileEnqueueing = heldDrafts.has("submission-1");
      return input;
    });

    request.mockImplementation(async () => {
      logOutDuringRequest();
      throw new ApiError("Session expired", 401, "Unauthorized");
    });

    await submit();

    expect(heldWhileEnqueueing).toBe(true);
    expect(heldDrafts.has("submission-1")).toBe(false);
    expect(releases).toEqual(["submission-1"]);
  });

  it("is plainly queued when only the connection failed and the driver is still signed in", async () => {
    request.mockImplementation(async (endpoint) => {
      if (endpoint === PRESIGN) {
        return {
          uploads: [{ key: "k1", uploadUrl: "https://s3/u1", expiresIn: 60 }],
        };
      }

      throw new ApiError("Network error", 0, "Network Error", "NETWORK");
    });

    await expect(submit()).resolves.toBe("queued");
    expect(getSubmissionOwner()).toBe("user-a");
  });

  it("is queued until the update when the API turned this build away (GAP5-2)", async () => {
    // The presign is the first request of a send with photos, and the gate
    // refuses it like any other.
    request.mockImplementation(async () => {
      throw new ApiError(
        "Esta versão do aplicativo não é mais aceita.",
        426,
        "Upgrade Required",
        "HTTP",
        "CLIENT_UPGRADE_REQUIRED",
      );
    });

    await expect(submit()).resolves.toBe("queued-until-update");

    expect(enqueueSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ id: "submission-1", ownerUserId: "user-a" }),
    );
    expect(getSubmissionOwner()).toBe("user-a");
  });

  it("still hands a refusal on the merits back to the screen, and lets go of the draft", async () => {
    request.mockImplementation(async (endpoint) => {
      if (endpoint === PRESIGN) {
        return {
          uploads: [{ key: "k1", uploadUrl: "https://s3/u1", expiresIn: 60 }],
        };
      }

      throw new ApiError("Quilometragem inválida", 400, "Bad Request");
    });

    await expect(submit()).rejects.toMatchObject({ status: 400 });

    expect(enqueueSubmission).not.toHaveBeenCalled();
    expect(releases).toEqual(["submission-1"]);
  });
});
