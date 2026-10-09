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

/**
 * What "Enviar agora" (the logout warning, MOB-15) and "Tentar enviar agora"
 * (the pending screen) make due at once: this driver's own items that are
 * waiting on the backoff.
 *
 * A pending item that already failed on a weak signal waits up to fifteen
 * minutes (times the jitter) for its next try, and a plain pass skips it —
 * the button spun and sent nothing in exactly the case it exists for. A tap
 * is a person asking, like "Tentar agora", so the schedule gives way.
 * Parked, failed and unclaimed items are not hurried: each has its own
 * decision on the pending screen.
 */
function isHurriableBy(
  item: OwnedSubmission,
  currentUserId: string | null,
): boolean {
  return (
    classifyOwnership(item, currentUserId) === "own" &&
    item.status === "pending"
  );
}

/**
 * Said by every "send now" button when some of those items are still here
 * afterwards, so a tap that could not send everything never looks like one
 * that did nothing.
 */
const SEND_NOW_INCOMPLETE_MESSAGE =
  "Nem tudo foi enviado agora. Verifique a conexão e tente de novo; o que ficou continua guardado neste aparelho.";

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
type OutboxFailure =
  | "transient"
  | "auth"
  | "permanent"
  | "module-disabled"

  // The API could not find a photo this item already uploaded.
  | "reupload"

  // This build no longer speaks the API's contract; an update may.
  | "contract";

/**
 * Refusals that are about the REQUEST's shape, not about the work.
 *
 * The queue freezes an item — URL, body and all — when the driver presses
 * send, and delivers it to whatever API is running days later. A route that
 * was renamed, a field made mandatory, a build turned away: an app update
 * fixes those, and nothing the driver could decide would. They fail the item
 * like any refusal (visible, and discardable), but mark it, so that once the
 * app is updated it is sent again by itself — see `shouldRequeueAfterUpgrade`.
 *
 * Only codes. A 4xx without one is still read as a refusal on the merits.
 */
const CONTRACT_CODES = new Set([
  "ROUTE_NOT_FOUND",
  // The API's 410 for an endpoint a release removed on purpose — the same
  // situation as ROUTE_NOT_FOUND, but said explicitly.
  "ENDPOINT_RETIRED",
  "VALIDATION_ERROR",
  "PHOTO_REQUIRED",
  "PHOTOS_REQUIRED",
  "CLIENT_OUTDATED",
  "CLIENT_UPGRADE_REQUIRED",
]);

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

  /** How long the API asked us to wait (`Retry-After` on a 429 or a 503). */
  retryAfterMs?: number;
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

    // A 400 about the STORAGE, not the submission: an object this item had
    // uploaded is gone (the API used to delete it on a transient failure).
    // Final as a verdict on those keys, not on the work — the photos are
    // still on this phone and can simply go up again.
    if (failure.code === "UPLOADED_FILE_NOT_FOUND") return "reupload";

    if (failure.code && CONTRACT_CODES.has(failure.code)) return "contract";

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
 * How many times an item sends its photos again from the phone.
 *
 * One lost set of objects is the old API deleting them on a busy database, and
 * a fresh upload fixes it. The same answer after the photos went up afresh
 * several times is not the storage any more but a server bug, and staying
 * pending would push every photo over mobile data every quarter of an hour
 * forever. Past this, the item is failed, where the driver can see it.
 */
const MAX_REUPLOADS = 3;

// The longest the schedule ever waits, and so the longest a `Retry-After` may
// hold an item back.
const MAX_RETRY_DELAY_MS = Math.max(...RETRY_DELAYS_MS);

/**
 * How long a `Retry-After` holds an item back: what the API asked for, up to
 * the schedule's own ceiling. Shared by a failed queue attempt and by a
 * submission queued straight from the screen after a 429, which used to be
 * due at once and went back into the same overload on the next sweep.
 */
const honouredRetryAfter = (retryAfterMs: number | undefined): number =>
  Math.min(Math.max(retryAfterMs ?? 0, 0), MAX_RETRY_DELAY_MS);

interface RetryOptions {
  /** Injected by tests; `Math.random` otherwise. */
  random?: () => number;

  /** The API's own `Retry-After`, when it sent one. */
  retryAfterMs?: number;
}

/**
 * What the queue does to an item that just failed.
 *
 * Returns null when the item must be left exactly as it is: an expired session
 * is not this item's fault and says nothing about whether it would be
 * accepted, so it keeps its attempt count and waits for a login.
 *
 * The delay is the schedule times a random 0.5–1.5. Without it, every phone
 * whose items failed together — a deploy, a database blink — came back at the
 * same moment and failed together again. A `Retry-After` from the API is a
 * floor on top of that, capped at the schedule's own maximum.
 */
function nextAfterFailure(
  item: { attempts: number; reuploads?: number },
  failure: OutboxFailure,
  now: number,
  options: RetryOptions = {},
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

  const random = options.random ?? Math.random;
  const jittered = Math.round(retryDelay(attempts) * (0.5 + random()));
  const askedFor = honouredRetryAfter(options.retryAfterMs);

  const exhausted =
    failure === "reupload" && (item.reuploads ?? 0) >= MAX_REUPLOADS;

  return {
    attempts,
    nextAttemptAt: now + Math.max(jittered, askedFor),
    // A contract refusal fails like one on the merits — never `parked`:
    // parked items go back in line whenever their module is seen enabled
    // (shouldUnpark), which for this one would resend and refail forever.
    status:
      failure === "permanent" || failure === "contract" || exhausted
        ? "failed"
        : "pending",
  };
}

/** The newest thing the server said about one module of one company. */
interface ModuleObservation {
  enabled: boolean;

  /** When the server said it, by the phone's clock (same clock as `parkedAt`). */
  observedAt: number;
}

/**
 * Whether a parked item goes back in line (MOB-03).
 *
 * It used to go back whenever the deliveries list loaded, whatever module the
 * item needed. A refuelling parked by a company without Gestão de Frota but
 * with Entregas was unparked, refused, parked and unparked again in a loop —
 * one POST per turn while the app was open — and in a company with only
 * Gestão de Frota it never went back at all, even after the module returned.
 *
 * Two conditions now, both about evidence:
 * - the server said the item's OWN module is enabled for the item's company;
 * - it said so AFTER the refusal that parked the item. An answer older than
 *   the refusal was already contradicted by it — acting on it again is the
 *   loop. So each new word from the server buys at most one attempt.
 *
 * Items parked by builds that did not record `parkedAt` count as parked at
 * the epoch: the first observation of their module sends them.
 */
function shouldUnpark(
  item: { status: OutboxStatus; parkedAt?: number },
  observation: ModuleObservation | null | undefined,
): boolean {
  if (item.status !== "parked") return false;
  if (!observation?.enabled) return false;

  return observation.observedAt > (item.parkedAt ?? 0);
}

/**
 * The photos with every upload forgotten, so the next attempt sends them all
 * again from the files on the phone.
 */
function forgetUploads<T extends { uploadedKey?: string }>(photos: T[]): T[] {
  return photos.map((photo) => {
    const { uploadedKey: _forgotten, ...rest } = photo;

    return rest as T;
  });
}

/**
 * How long a queued "Iniciar rota" stays worth sending (MOB-08).
 *
 * Every other submission records something that happened — a proof, an
 * arrival, a fueling — and stays true however late it arrives. A departure is
 * a command about the day it was tapped in. The old endpoint (no route) picks
 * its deliveries when the request RUNS, so a tap queued yesterday and sent
 * today puts on the street whatever was assigned since, with the truck still
 * in the yard. The route endpoint names its route, but a route still waiting
 * half a day after the tap belongs to a day that moved on, and leaving with
 * it would tell every customer on it that their delivery left. Half a day
 * covers any shift; past it, the driver decides.
 *
 * Both instants come from the phone's own clock, so its error cancels out.
 */
const START_ROUTE_SEND_TTL_MS = 12 * 60 * 60 * 1000;

const START_ROUTE_EXPIRED_MESSAGE =
  "Início de rota expirado: toque em Iniciar rota novamente se ainda for sair.";

function isSendExpired(
  item: { kind: string; createdAt: string },
  now: number,
): boolean {
  if (item.kind !== "delivery-start-route") return false;

  const createdAt = Date.parse(item.createdAt);

  // An item whose age cannot be read is sent: guessing "expired" would drop a
  // departure nobody decided to drop.
  if (!Number.isFinite(createdAt)) return false;

  return now - createdAt > START_ROUTE_SEND_TTL_MS;
}

/** What "Tentar de novo" can do for an item on the pending screen. */
type ResendVerdict = { resendable: true } | { resendable: false; reason: string };

/**
 * Whether sending the item again can succeed, and what to tell the driver
 * when it cannot.
 *
 * A retry goes back through the same pass that failed it, so an expired
 * departure fails again at once (isSendExpired): the button only turned the
 * same red card over in a loop. It is not offered; the reason says what the
 * driver can do instead — tap "Iniciar rota" again if the truck is still
 * leaving. Everything else stays resendable: a rejection may be fixed on the
 * server, and only the person looking at it knows.
 */
function resendVerdict(
  item: { kind: string; createdAt: string },
  now: number,
): ResendVerdict {
  if (isSendExpired(item, now)) {
    return { resendable: false, reason: START_ROUTE_EXPIRED_MESSAGE };
  }

  return { resendable: true };
}

export {
  CONTRACT_CODES,
  canActOn,
  claim,
  classifyFailure,
  classifyOwnership,
  forgetUploads,
  honouredRetryAfter,
  isHurriableBy,
  isSendExpired,
  isSendableBy,
  isVisibleTo,
  nextAfterFailure,
  resendVerdict,
  retryDelay,
  selectSendable,
  selectVisible,
  shouldUnpark,
  MAX_REUPLOADS,
  RETRY_DELAYS_MS,
  SEND_NOW_INCOMPLETE_MESSAGE,
  START_ROUTE_EXPIRED_MESSAGE,
  START_ROUTE_SEND_TTL_MS,
};

export type {
  FailureDescription,
  ModuleObservation,
  OutboxFailure,
  OutboxStatus,
  OwnedSubmission,
  ResendVerdict,
  RetryOptions,
  SubmissionOwnership,
};
