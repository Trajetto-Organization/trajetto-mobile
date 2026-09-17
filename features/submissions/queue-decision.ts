import { classifyFailure, type FailureDescription } from "./outbox-rules";

/**
 * Whether a failed submission is queued, or handed back to the screen.
 *
 * This is the decision that says whether a driver's work survives. It lived
 * inside a `try/catch` in `submit-or-queue`, wrapped around an HTTP client and
 * a storage upload — so the one rule in the app that decides between "keep it"
 * and "lose it" could not be read by a test without mocking a network.
 *
 * The three outcomes, in the order they are decided:
 *
 * - **cancelled**: the driver pressed cancel. Their own doing, and queueing it
 *   would resurrect on Monday a submission they abandoned on Friday.
 * - **rejected**: the API answered, and the answer was no. A malformed body,
 *   a delivery that is already closed, a permission that is gone. Queueing it
 *   means retrying forever against an answer that will not change, and hiding
 *   from the driver that it was refused.
 * - **queued**: nothing answered. No signal, a timeout, a 502 from a proxy —
 *   **no answer from the API is not the API saying no**, and this is the whole
 *   reason the outbox exists.
 */
type QueueDecision = "cancelled" | "rejected" | "queued";

interface SubmissionFailure {
  /** The driver pressed cancel, or the screen was left. */
  isAbort: boolean;

  /** Whatever the caller's error flattened into; see `outbox-rules`. */
  description: FailureDescription;
}

function decideSubmissionFailure(failure: SubmissionFailure): QueueDecision {
  /*
    Checked FIRST, and separately from everything else. An aborted fetch
    rejects with an error that looks like a network failure from the inside —
    classify it and it comes back "transient", which would resurrect on Monday
    every submission a driver abandoned on Friday.
  */
  if (failure.isAbort) return "cancelled";

  return classifyFailure(failure.description) === "transient"
    ? "queued"
    : "rejected";
}

interface PhotoEntry {
  /**
   * The picked file, as the picker hands it over.
   *
   * Every field but the uri is optional here because that is what a camera
   * roll actually returns — a photo from some Android gallery providers
   * arrives with no name and no size. The queue stores what it got.
   */
  file: {
    uri: string;
    fileName?: string | null;
    fileSize?: number;
    mimeType?: string | null;
  };

  fieldName?: string;

  /** A key from an earlier attempt that already reached storage. */
  uploadedKey?: string;
}

interface QueuedPhoto {
  uri: string;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string | null;
  fieldName?: string;
  uploadedKey?: string;
}

/**
 * The photos to hand the queue, carrying whatever already reached storage.
 *
 * A checklist can hold twenty photos and a driver's connection can drop on the
 * nineteenth. Everything that landed before the failure is already in storage,
 * paid for on a phone connection, and the keys are what stop the retry from
 * uploading it all again — on a link that drops every few minutes, a queue
 * that restarts from zero never finishes.
 *
 * Two sources, and the order matters: a key from an EARLIER attempt is already
 * on the entry, and a key from THIS attempt is in the map. The entry wins
 * where both exist, because it is the one that survived a previous round trip.
 */
function photosForQueue(
  entries: PhotoEntry[],
  landedKeys: Map<number, string>,
): QueuedPhoto[] {
  return entries.map((entry, index) => ({
    uri: entry.file.uri,
    fileName: entry.file.fileName,
    fileSize: entry.file.fileSize,
    mimeType: entry.file.mimeType,
    fieldName: entry.fieldName,
    uploadedKey: entry.uploadedKey ?? landedKeys.get(index),
  }));
}

export {
  decideSubmissionFailure,
  photosForQueue,
  type PhotoEntry,
  type QueueDecision,
  type QueuedPhoto,
  type SubmissionFailure,
};
