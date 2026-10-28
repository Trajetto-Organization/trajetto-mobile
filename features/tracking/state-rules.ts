import { isTerminalAuthFailure } from "@/utils/api-error";

import {
  MAX_FLUSH_BATCH,
  appendPing,
  shouldFlush,
  shouldKeepPing,
  type TrackablePing,
} from "./position-rules";

/**
 * What the tracking state becomes, given what just happened.
 *
 * Pure on purpose, and the reason is the same one the rest of this folder
 * gives: the code that DECIDES must be readable by a test without a phone.
 * Everything here used to live inside a hook's refs, where it was not only
 * untestable but wrong for the background task — a second JavaScript context
 * with no refs at all.
 */
interface TrackingState {
  buffer: TrackablePing[];

  /** The last fix actually stored, for the stationary filter. */
  lastKept: TrackablePing | null;

  lastFlushAt: number | null;

  /** Set when the API says there is nothing to follow any more. */
  stopped: boolean;

  /**
   * Whose points these are.
   *
   * The state lives on the DEVICE, not in the session. A shared phone in a
   * truck cab handed the buffer of the driver who logged out to the next one,
   * whose token then carried it — and the API files positions under the
   * session's driver and route: someone else's trail, possibly another
   * company's. `null` is a state saved before this field existed.
   */
  ownerId: string | null;
}

const EMPTY_STATE: TrackingState = {
  buffer: [],
  lastKept: null,
  lastFlushAt: null,
  stopped: false,
  ownerId: null,
};

/**
 * The state to start from, given what storage had.
 *
 * `legacy` is the older key, from when only the buffer was persisted. A driver
 * updating the app mid-route has points in it, and they are the ones covering
 * the stretch somebody will ask about.
 */
function restoreFrom(
  saved: Partial<TrackingState> | null,
  legacy: TrackablePing[] | null,
): TrackingState {
  if (saved) return { ...EMPTY_STATE, ...saved };

  if (legacy?.length) {
    return {
      ...EMPTY_STATE,
      buffer: legacy,

      // The last of them becomes the stationary reference, or the first fix
      // after an update would always be kept however little moved.
      lastKept: legacy[legacy.length - 1],
    };
  }

  return { ...EMPTY_STATE };
}

/**
 * A batch of fixes, from wherever they came.
 *
 * The foreground watcher hands one at a time; the background task hands
 * whatever the OS batched while the screen was off. Applying the stationary
 * filter ACROSS the batch is what makes those two agree — filtering each fix
 * against the last STORED one only, and then storing all of them, would keep
 * a whole batch of a parked truck.
 */
function ingestInto(
  state: TrackingState,
  fixes: TrackablePing[],
  now?: number,
): { state: TrackingState; kept: number; flushNow: boolean } {
  if (state.stopped) return { state, kept: 0, flushNow: false };

  let buffer = state.buffer;
  let lastKept = state.lastKept;

  let kept = 0;

  for (const fix of fixes) {
    if (!shouldKeepPing(lastKept, fix)) continue;

    lastKept = fix;
    buffer = appendPing(buffer, fix);

    kept += 1;
  }

  const next = { ...state, buffer, lastKept };

  return {
    state: next,
    kept,
    flushNow: shouldFlush({
      buffered: buffer.length,
      lastFlushAt: state.lastFlushAt,
      now,
    }),
  };
}

/**
 * After the API took a batch.
 *
 * `tracking: false` is the API saying no route of this driver's is running —
 * the phone's own view of the day can be stale, and the dispatcher may have
 * cancelled the route while the driver was out of signal.
 */
function afterFlushSuccess(
  state: TrackingState,
  tracking: boolean,
  now: number,
): TrackingState {
  return { ...state, lastFlushAt: now, stopped: !tracking };
}

/**
 * A point's identity across a storage round trip. The stored buffer is a
 * JSON copy, never the objects that were sent, so points are matched by
 * value: two fixes with the same instant and place are the same fix.
 */
function pingKey(ping: TrackablePing): string {
  return `${ping.recorded_at}|${ping.latitude}|${ping.longitude}`;
}

/**
 * The buffer without the points a flush attempt settled — each one once.
 *
 * Only those: points a second JavaScript context (the background task)
 * appended while the request was in flight are newer and stay, and the
 * unsent part of the batch stays exactly where it was, in front of them.
 */
function withoutSettled(
  buffer: TrackablePing[],
  settled: TrackablePing[],
): TrackablePing[] {
  const remaining = new Map<string, number>();

  for (const ping of settled) {
    const key = pingKey(ping);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  return buffer.filter((ping) => {
    const key = pingKey(ping);
    const count = remaining.get(key) ?? 0;

    if (count === 0) return true;

    remaining.set(key, count - 1);
    return false;
  });
}

/**
 * After a flush attempt, whatever the answer: the batch never left storage
 * before its request (a background task killed mid-request used to lose up
 * to a whole batch), so only what the API settled leaves now — the points it
 * took (2xx) and the lone points it refused as invalid. The rest stays in
 * order, at the front, for the next flush; the API discards a point sent
 * twice. The cap is re-applied for a buffer restored above it.
 */
function afterFlushAttempt(
  state: TrackingState,
  settled: TrackablePing[],
): TrackingState {
  return { ...state, buffer: capBuffer(withoutSettled(state.buffer, settled)) };
}

/**
 * What an answer other than 200 means for a batch of positions.
 *
 * - `invalid` (400): a verdict on the points — halve and find the bad one.
 * - `forbidden` (403 from the API itself): a verdict on the PHONE. The module
 *   was switched off (MODULE_NOT_ENABLED), the company deactivated
 *   (TENANT_INACTIVE) or the permission taken away. Sending the same batch
 *   every two minutes, GPS on, was retrying an answer that will not change
 *   (MOB-TRK-4): it is the API's `tracking: false`, said with a status.
 * - `signed-out` (401): the session is over. The points are still this
 *   driver's and go out if they sign in again, but nothing is collected
 *   meanwhile.
 * - `retry`: no signal, a 5xx, a 429, or a 403 from something in front of the
 *   API (an HTML page, not the API's JSON) — the moment, not the phone.
 */
type BatchFailure = "invalid" | "forbidden" | "signed-out" | "retry";

function classifyBatchFailure(error: unknown): BatchFailure {
  const answer = error as {
    status?: unknown;
    code?: unknown;
    nonJsonBody?: unknown;
  } | null;

  const status = typeof answer?.status === "number" ? answer.status : null;

  if (status === 400) return "invalid";
  if (status === 401) return "signed-out";
  if (status === 403 && answer?.nonJsonBody !== true) return "forbidden";

  // A session-ending code on another status (404 USER_NOT_FOUND: the
  // driver's user was deleted mid-session) is the 401 said differently.
  // Read as "retry", the same batch went out every two minutes, GPS on.
  if (
    status !== null &&
    typeof answer?.code === "string" &&
    isTerminalAuthFailure(status, answer.code)
  ) {
    return "signed-out";
  }

  return "retry";
}

/**
 * After the API refused the phone itself: stop, and forget what is buffered.
 *
 * The points cannot be filed anywhere — the same refusal waits for every one
 * of them — and kept, they would go out under whatever route starts next.
 */
function afterFlushForbidden(state: TrackingState): TrackingState {
  return { ...state, buffer: [], stopped: true };
}

/**
 * After the session ended mid-flush: stop collecting, keep what was
 * collected but not settled. It is this driver's trail, and it goes out when
 * they sign in again (`claimFor` keeps an owner's own points).
 */
function afterSignedOut(
  state: TrackingState,
  settled: TrackablePing[],
): TrackingState {
  return { ...afterFlushAttempt(state, settled), stopped: true };
}

/**
 * Whether whoever is collecting fixes should stop asking the OS for them.
 *
 * The background task runs where no React effect does — after the app was
 * killed — and was the one place nothing ever stopped: the API said
 * `tracking: false`, the fixes were dropped one by one, and the GPS and the
 * "Rota em andamento" notification ran on until the driver opened the app
 * (MOB-TRK-3). Nobody signed in is the same answer: there is no one to report
 * for.
 */
function shouldHaltTracking(input: {
  signedIn: boolean;
  stopped: boolean;
}): boolean {
  return !input.signedIn || input.stopped;
}

/**
 * The state as far as THIS user is concerned.
 *
 * A state that is someone else's — or nobody's, saved before states had an
 * owner — is dropped, points and all. They cannot be sent as who they belong
 * to, and sent as anyone else they are a false trail. Losing a few minutes of
 * a trail that already ended beats writing it into the wrong one.
 */
function claimFor(state: TrackingState, userId: string): TrackingState {
  return state.ownerId === userId ? state : { ...EMPTY_STATE, ownerId: userId };
}

/**
 * The oldest points first, at most one request's worth. A copy: the batch
 * stays in the stored buffer until the API settles it (`afterFlushAttempt`).
 */
function takeFlushBatch(buffer: TrackablePing[]): TrackablePing[] {
  return buffer.slice(0, MAX_FLUSH_BATCH);
}

/**
 * A batch the API refused as invalid, in halves — or nothing, when it is down
 * to the one point that is wrong.
 *
 * Refused points used to go back into the buffer with the rest, so a single
 * one the schema rejects (a NaN speed serializes as null) poisoned every
 * flush after it. Halving until the culprit is alone costs a handful of
 * requests once, and keeps every valid point.
 */
function splitRefused(batch: TrackablePing[]): TrackablePing[][] {
  if (batch.length <= 1) return [];

  const middle = Math.ceil(batch.length / 2);

  return [batch.slice(0, middle), batch.slice(middle)];
}

/** The same ceiling `appendPing` enforces, applied to a whole restored batch. */
function capBuffer(buffer: TrackablePing[]): TrackablePing[] {
  let capped: TrackablePing[] = [];

  for (const ping of buffer) capped = appendPing(capped, ping);

  return capped;
}

export {
  EMPTY_STATE,
  afterFlushAttempt,
  afterFlushForbidden,
  afterFlushSuccess,
  afterSignedOut,
  capBuffer,
  claimFor,
  classifyBatchFailure,
  ingestInto,
  pingKey,
  restoreFrom,
  shouldHaltTracking,
  splitRefused,
  takeFlushBatch,
  withoutSettled,
  type BatchFailure,
  type TrackingState,
};
