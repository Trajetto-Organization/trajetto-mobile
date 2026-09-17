import { apiClient } from "@/utils/api";

import {
  uploadToStorage,
  type UploadEntry,
  type UploadType,
} from "@/features/media/upload-to-storage";

import {
  buildPhotoPayload,
  describeFailure,
  enqueueSubmission,
  type OutboxKind,
  type OutboxPhotoField,
} from "@/features/submissions/outbox";

import {
  decideSubmissionFailure,
  photosForQueue,
} from "@/features/submissions/queue-decision";

interface SubmitOrQueueInput {
  /** Idempotency key. The same value identifies the queued item. */
  submissionId: string;

  kind: OutboxKind;
  endpoint: string;
  body: Record<string, unknown>;

  businessId: string;

  /** Absent for delivery submissions — those belong to a delivery. */
  vehicleId?: string;
  vehicleLabel?: string;

  entries: UploadEntry[];
  uploadType: UploadType;

  photoField: OutboxPhotoField;

  signal?: AbortSignal;
  onProgress?: (uploaded: number, total: number) => void;
}

type SubmitOutcome = "sent" | "queued";

/**
 * Sends a submission, or hands it to the queue if the network would not have it.
 *
 * Both the checklist and the refuelling go through here rather than each
 * writing their own try/catch, because the decision they share is the delicate
 * one: **no answer from the API is not the API saying no.** Getting that
 * backwards in one of them and not the other is how a driver ends up losing an
 * inspection in a garage while the other screen quietly survives the same
 * outage. One implementation, one behaviour.
 *
 * Returns what happened so the caller can pick its own wording; anything it
 * throws is a real rejection on the merits, which belongs on screen.
 */
async function submitOrQueue({
  submissionId,
  kind,
  endpoint,
  body,
  businessId,
  vehicleId,
  vehicleLabel,
  entries,
  uploadType,
  photoField,
  signal,
  onProgress,
}: SubmitOrQueueInput): Promise<SubmitOutcome> {
  // Keys are recorded as they land so that a failure partway through twenty
  // photos is not thrown away: whatever reached storage is handed to the queue,
  // which then only has to send the rest.
  const landedKeys = new Map<number, string>();

  try {
    const uploaded = await uploadToStorage({
      entries,
      uploadType,
      businessId,
      signal,
      onProgress,
      onUploaded: (index, key) => landedKeys.set(index, key),
    });

    const payload = buildPhotoPayload(photoField, body, uploaded);

    await apiClient.request(endpoint, {
      method: "POST",
      body: payload,
      signal,
      headers: { "Idempotency-Key": submissionId },
    });

    return "sent";
  } catch (error) {
    /*
      The decision itself is in `queue-decision`, where a test can read it.
      This function cannot be tested without mocking an HTTP client and a
      storage upload, and the rule it was hiding is the one that decides
      whether a driver's afternoon survives.
    */
    const outcome = decideSubmissionFailure({
      isAbort: error instanceof Error && error.name === "AbortError",
      description: describeFailure(error),
    });

    if (outcome !== "queued") throw error;

    await enqueueSubmission({
      id: submissionId,
      kind,
      businessId,
      vehicleId,
      vehicleLabel,
      endpoint,
      body,
      uploadType,
      photoField,
      photos: photosForQueue(entries, landedKeys),
    });

    return "queued";
  }
}

export { submitOrQueue };
export type { SubmitOrQueueInput, SubmitOutcome };
