/**
 * Whose queued submission is this, and may it be sent right now.
 *
 * Kept pure and free of imports so the decisions that protect one driver from
 * another's data can be tested without AsyncStorage, the filesystem or a
 * session — the same reason `delivery-rules`, `fuel-rules` and `chat-rules`
 * sit apart from the hooks that use them.
 */

/** Just enough of a queued item to decide whose it is and whether it is due. */
interface OwnedSubmission {
  /**
   * The user who queued it. Absent on items written before ownership was
   * recorded: the device cannot tell whose they are, so they are neither
   * sent nor deleted — see `SubmissionOwnership`.
   */
  ownerUserId?: string;

  status: "pending" | "failed" | "parked";
  nextAttemptAt: number;
}

/**
 * - `own`: queued by the user who is signed in now.
 * - `foreign`: queued by someone else. Invisible, untouchable, and above all
 *   never sent — it would reach the API under the wrong driver's token and
 *   record the wrong person as having made the delivery.
 * - `unclaimed`: queued before this device recorded ownership. Nobody can
 *   prove whose it is, so the app refuses to guess: it shows the item and
 *   lets a person decide to send or discard it. Guessing wrong in the
 *   sending direction is the same harm as `foreign`; guessing wrong in the
 *   deleting direction destroys a proof of delivery.
 */
type SubmissionOwnership = "own" | "foreign" | "unclaimed";

function classifyOwnership(
  item: OwnedSubmission,
  currentUserId: string | null,
): SubmissionOwnership {
  if (!item.ownerUserId) return "unclaimed";
  if (!currentUserId) return "foreign";

  return item.ownerUserId === currentUserId ? "own" : "foreign";
}

/** What this driver may see on the pending screen. */
function isVisibleTo(
  item: OwnedSubmission,
  currentUserId: string | null,
): boolean {
  return classifyOwnership(item, currentUserId) !== "foreign";
}

/**
 * What the queue may send without asking anyone.
 *
 * Deliberately narrower than `isVisibleTo`: an unclaimed item is shown but
 * never sent on its own. Someone has to take responsibility for it first,
 * which `claim` is for.
 */
function isSendableBy(
  item: OwnedSubmission,
  currentUserId: string | null,
  now: number,
): boolean {
  if (classifyOwnership(item, currentUserId) !== "own") return false;

  return item.status === "pending" && item.nextAttemptAt <= now;
}

function selectVisible<TItem extends OwnedSubmission>(
  items: TItem[],
  currentUserId: string | null,
): TItem[] {
  return items.filter((item) => isVisibleTo(item, currentUserId));
}

function selectSendable<TItem extends OwnedSubmission>(
  items: TItem[],
  currentUserId: string | null,
  now: number,
): TItem[] {
  return items.filter((item) => isSendableBy(item, currentUserId, now));
}

/**
 * Whether this driver may act on the item at all — retry, claim, discard.
 *
 * Foreign items fail this even though the UI never offers them, because the
 * queue is reachable from places that are not the UI.
 */
function canActOn(
  item: OwnedSubmission,
  currentUserId: string | null,
): boolean {
  return Boolean(currentUserId) && isVisibleTo(item, currentUserId);
}

/**
 * Takes responsibility for an unclaimed item, at a person's explicit request.
 *
 * Only ever widens `unclaimed` into `own` — an item that already has an owner
 * keeps it, so this can never move work from one driver to another.
 */
function claim<TItem extends OwnedSubmission>(
  item: TItem,
  currentUserId: string,
): TItem {
  return item.ownerUserId ? item : { ...item, ownerUserId: currentUserId };
}

/**
 * Why a send failed, and therefore what to do about it.
 *
 * This distinction is the whole point of the queue: no answer from the API is
 * not the same as the API saying no. The first is worth repeating forever, the
 * second never is.
 */
type OutboxFailure = "transient" | "auth" | "permanent" | "module-disabled";

type OutboxStatus = "pending" | "failed" | "parked";

/**
 * A failure described rather than thrown.
 *
 * The classification used to live next to the sender, where it could read
 * `error instanceof ApiError` — and where nothing could test it, because
 * reaching that module means loading AsyncStorage, expo-file-system and the
 * HTTP client. What decides whether a driver's proof is retried, parked or
 * abandoned deserves better than that, so the caller flattens its error into
 * this shape and the decision moves here, where the tests are.
 */
interface FailureDescription {
  source: "api" | "upload" | "unknown";
  isAuthenticationError?: boolean;
  isTransient?: boolean;
  code?: string | null;
}

/**
 * Backoff between attempts after a transient failure.
 *
 * Capped rather than doubling forever: an outage that lasts a whole shift must
 * not leave the queue waiting on a timer that grew while nobody was watching.
 * Regaining signal also triggers a pass immediately, so these delays only pace
 * retries that happen while the connection looks fine but is not.
 */
const RETRY_DELAYS_MS = [0, 15_000, 60_000, 5 * 60_000, 15 * 60_000];

function classifyFailure(failure: FailureDescription): OutboxFailure {
  if (failure.source === "api") {
    if (failure.isAuthenticationError) return "auth";
    if (failure.isTransient) return "transient";

    // The whole module is off, not this item: it parks until the module comes
    // back instead of burning retries or asking a person to decide.
    if (failure.code === "MODULE_NOT_ENABLED") return "module-disabled";

    // A 4xx that is not a timeout or a rate limit is the API saying no on the
    // merits — mileage below the vehicle's, an inactive branch. Repeating it
    // produces the same answer forever.
    return "permanent";
  }

  // A failed PUT is network-shaped: an expired signature is re-signed on the
  // next attempt, and everything else is the connection.
  //
  // An unknown throw is treated the same way on purpose. Guessing "permanent"
  // for something nobody recognised would throw away a driver's work over a
  // bug in our own code.
  return "transient";
}

const retryDelay = (attempts: number): number =>
  RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];

/**
 * What the queue does to an item that just failed.
 *
 * Returns null when the item must be left exactly as it is: an expired session
 * is not this item's fault and says nothing about whether it would be
 * accepted, so it keeps its attempt count and waits for a login.
 */
function nextAfterFailure(
  item: { attempts: number },
  failure: OutboxFailure,
  now: number,
): { attempts: number; nextAttemptAt: number; status: OutboxStatus } | null {
  if (failure === "auth") return null;

  if (failure === "module-disabled") {
    return {
      attempts: item.attempts,
      nextAttemptAt: now,
      status: "parked",
    };
  }

  const attempts = item.attempts + 1;

  return {
    attempts,
    nextAttemptAt: now + retryDelay(attempts),
    status: failure === "permanent" ? "failed" : "pending",
  };
}

export {
  canActOn,
  claim,
  classifyFailure,
  classifyOwnership,
  isSendableBy,
  isVisibleTo,
  nextAfterFailure,
  retryDelay,
  selectSendable,
  selectVisible,
  RETRY_DELAYS_MS,
};

export type {
  FailureDescription,
  OutboxFailure,
  OutboxStatus,
  OwnedSubmission,
  SubmissionOwnership,
};
