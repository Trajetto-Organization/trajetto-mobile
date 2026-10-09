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
  isCancellation,
  photosForQueue,
  queuedOutcome,
  type QueuedOutcome,
} from "@/features/submissions/queue-decision";

import {
  getSubmissionPersistenceEpoch,
  holdSubmissionDrafts,
} from "@/features/submissions/submission-id";
import { getSubmissionOwner } from "@/features/submissions/submission-owner";

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

  /**
   * The API's answer, when it was sent at the tap. For the kinds that keep
   * something from it (kind-effects); the queue hands a later send's answer
   * to the same code. A throw here never turns a sent item into a failure.
   */
  onSent?: (response: unknown) => void | Promise<void>;
}

/**
 * "queued-signed-out" and "queued-until-update" are additive: a caller that
 * only checks for "sent" treats them as queued, which they are — only the
 * wording differs.
 */
type SubmitOutcome = "sent" | QueuedOutcome;

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
  onSent,
}: SubmitOrQueueInput): Promise<SubmitOutcome> {
  // Captured before anything is sent. A 401 that cannot be refreshed logs the
  // driver out from INSIDE the request, so by the time its error lands here
  // the session — and the owner the queue would stamp — is already gone.
  const ownerUserId = getSubmissionOwner();
  const sessionEpoch = getSubmissionPersistenceEpoch();

  // That same logout deletes every draft, and the photos being sent are draft
  // files until the queue has made its own copy.
  const releaseDrafts = holdSubmissionDrafts(submissionId);

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

    const response = await apiClient.request<unknown>(endpoint, {
      method: "POST",
      body: payload,
      signal,
      headers: {
        "Idempotency-Key": submissionId,

        // The send, by the clock that stamped the body's `occurred_at`. The
        // queue's resends add the same header (MOB-08).
        "X-Client-Sent-At": new Date().toISOString(),
      },
    });

    // Swallowed here, before the catch below can see it: the record landed,
    // and an effect that fails must not queue it again or report it refused.
    try {
      await onSent?.(response);
    } catch {
      // Best-effort by contract (see `onSent`).
    }

    return "sent";
  } catch (error) {
    /*
      The decision itself is in `queue-decision`, where a test can read it.
      This function cannot be tested without mocking an HTTP client and a
      storage upload, and the rule it was hiding is the one that decides
      whether a driver's afternoon survives.
    */
    const description = describeFailure(error);

    const failure = {
      isAbort: isCancellation(error, signal),
      sessionEnded:
        ownerUserId !== null &&
        getSubmissionPersistenceEpoch() !== sessionEpoch,
      description,
    };

    if (decideSubmissionFailure(failure) !== "queued") throw error;

    await enqueueSubmission({
      id: submissionId,
      kind,
      businessId,
      ownerUserId: ownerUserId ?? undefined,
      vehicleId,
      vehicleLabel,
      endpoint,
      body,
      uploadType,
      photoField,
      photos: photosForQueue(entries, landedKeys),

      // A 429 or 503 on the first try: the queue waits it out too.
      retryAfterMs: description.retryAfterMs,
    });

    // "queued-signed-out" when it waits for this driver to sign in again, and
    // "queued-until-update" when it waits for the app's update, rather than
    // for a connection, so the screen does not promise the wrong thing
    // (MOB-07, GAP5-2).
    return queuedOutcome(failure);
  } finally {
    releaseDrafts();
  }
}

export { submitOrQueue };
export type { SubmitOrQueueInput, SubmitOutcome };
