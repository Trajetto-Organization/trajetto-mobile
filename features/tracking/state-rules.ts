import {
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
}

const EMPTY_STATE: TrackingState = {
  buffer: [],
  lastKept: null,
  lastFlushAt: null,
  stopped: false,
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
 * After the API did not.
 *
 * The batch goes back at the FRONT: it is older than whatever arrived while
 * the request was in flight, and a trail is only readable in order. The cap is
 * re-applied, because a phone that spent an hour in a dead zone can otherwise
 * grow the buffer past what any request may carry.
 */
function afterFlushFailure(
  state: TrackingState,
  sending: TrackablePing[],
): TrackingState {
  let buffer = state.buffer;

  for (let index = sending.length - 1; index >= 0; index -= 1) {
    buffer = [sending[index], ...buffer];
  }

  return { ...state, buffer: capBuffer(buffer) };
}

/** The same ceiling `appendPing` enforces, applied to a whole restored batch. */
function capBuffer(buffer: TrackablePing[]): TrackablePing[] {
  let capped: TrackablePing[] = [];

  for (const ping of buffer) capped = appendPing(capped, ping);

  return capped;
}

export {
  EMPTY_STATE,
  afterFlushFailure,
  afterFlushSuccess,
  capBuffer,
  ingestInto,
  restoreFrom,
  type TrackingState,
};
