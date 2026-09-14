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

export {
  canActOn,
  claim,
  classifyOwnership,
  isSendableBy,
  isVisibleTo,
  selectSendable,
  selectVisible,
};

export type { OwnedSubmission, SubmissionOwnership };
