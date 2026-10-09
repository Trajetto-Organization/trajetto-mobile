import { UPGRADE_REQUIRED_CODE } from "../app-update/upgrade-rules";
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
 *   reason the outbox exists. Also queued: the SESSION ended under the
 *   submission. That is not a verdict on the work either, and the queue keeps
 *   such an item untouched until its own driver signs in again. And a build
 *   the API turned away: the updated app sends it.
 */
type QueueDecision = "cancelled" | "rejected" | "queued";

interface SubmissionFailure {
  /** The driver pressed cancel, or the screen was left. */
  isAbort: boolean;

  /**
   * The session this submission started under is gone — logged out, revoked,
   * replaced — by the time it failed.
   */
  sessionEnded?: boolean;

  /** Whatever the caller's error flattened into; see `outbox-rules`. */
  description: FailureDescription;
}

/**
 * Whether the failure is the driver stopping the submission.
 *
 * The caller's own signal is the authority. The error name alone is not
 * enough: an abort that reached storage mid-upload used to come back as an
 * `UploadError`, which classifies as a connection failure — so a checklist the
 * driver discarded was queued and sent on the next sweep.
 */
function isCancellation(
  error: unknown,
  signal?: { aborted: boolean },
): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function decideSubmissionFailure(failure: SubmissionFailure): QueueDecision {
  /*
    Ahead even of the abort. A logout aborts every request in flight and
    unmounts the protected screens, whose cleanup aborts the form's own
    signal — neither abort is the driver changing their mind. Handing the
    work back instead meant losing it: the same logout had already deleted
    the draft.
  */
  if (failure.sessionEnded) return "queued";

  /*
    Checked before the classification, and separately from it. An aborted
    fetch rejects with an error that looks like a network failure from the
    inside — classify it and it comes back "transient", which would resurrect
    on Monday every submission a driver abandoned on Friday.
  */
  if (failure.isAbort) return "cancelled";

  // "auth" queues for the same reason `sessionEnded` does, and the outbox
  // already treats it that way: an item whose send meets an ended session is
  // left untouched until its driver signs in again.
  const classified = classifyFailure(failure.description);

  if (classified === "transient" || classified === "auth") return "queued";

  // The API turned this BUILD away (GAP5-2): not a verdict on the work, and
  // nothing the driver fixes on this build. Handed back, it lived only in the
  // screen, which the update screen's restart wipes; queued, the outbox fails
  // it as a contract failure and the updated app sends it by itself. The
  // other contract codes stay the driver's to see on the first try.
  return failure.description.code === UPGRADE_REQUIRED_CODE
    ? "queued"
    : "rejected";
}

/**
 * What a queued submission is waiting for (MOB-07).
 *
 * - **queued**: the connection. The queue sends it by itself once the API
 *   answers again.
 * - **queued-signed-out**: its own driver signing in again. The session ended
 *   under it — a logout from inside the request, a revocation — and the queue
 *   keeps the item for the driver who pressed send; no connection sends it
 *   before that driver is back. Telling them "when there is a connection"
 *   sent them waiting for a signal they already had.
 * - **queued-until-update**: the app's update. The API turned this build away
 *   (426 CLIENT_UPGRADE_REQUIRED); every send meets the same answer until the
 *   updated app sends it by itself.
 *
 * Only meaningful once `decideSubmissionFailure` said "queued".
 */
type QueuedOutcome = "queued" | "queued-signed-out" | "queued-until-update";

function queuedOutcome(failure: SubmissionFailure): QueuedOutcome {
  if (failure.sessionEnded) return "queued-signed-out";

  if (classifyFailure(failure.description) === "auth") {
    return "queued-signed-out";
  }

  return failure.description.code === UPGRADE_REQUIRED_CODE
    ? "queued-until-update"
    : "queued";
}

/**
 * The line under "<what> salvo no aparelho" in the screens' toast. One place,
 * so the checklist, the fueling and the delivery actions cannot drift apart
 * on the one sentence that tells the driver what happens to their work.
 */
const QUEUED_NOTICES: Record<QueuedOutcome, string> = {
  queued: "Será enviado automaticamente quando houver conexão.",
  "queued-signed-out":
    "Sua sessão foi encerrada. Será enviado quando você entrar de novo.",
  "queued-until-update":
    "Esta versão do app precisa ser atualizada. Será enviado depois da atualização.",
};

function queuedNotice(outcome: QueuedOutcome): string {
  return QUEUED_NOTICES[outcome];
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

/**
 * The vehicle as the next form should see it, once a fueling or checklist
 * with this reading is in the queue.
 *
 * The forms refuse a mileage that is not above the vehicle's, reading the
 * vehicle from the cache. A submission that lands moves the vehicle forward
 * and the next form sees it; a queued one did not, so a checklist and a
 * fueling filled in at the same stop with the same odometer both passed on
 * the phone — and the API refused the second days later, long after the form
 * that could have fixed it was gone. Only ever forward: the queue can hold an
 * older reading than one the server already reported.
 */
function bumpQueuedMileage<T extends { current_mileage?: number | null }>(
  vehicle: T | null | undefined,
  mileage: number,
): T | null | undefined {
  if (!vehicle || !Number.isFinite(mileage)) return vehicle;

  return mileage > (vehicle.current_mileage ?? 0)
    ? { ...vehicle, current_mileage: mileage }
    : vehicle;
}

export {
  bumpQueuedMileage,
  decideSubmissionFailure,
  isCancellation,
  photosForQueue,
  queuedNotice,
  queuedOutcome,
  type PhotoEntry,
  type QueueDecision,
  type QueuedOutcome,
  type QueuedPhoto,
  type SubmissionFailure,
};
