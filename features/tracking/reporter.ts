import { apiClient } from "@/utils/api";
import { logger } from "@/utils/logger";

import { asyncStorage } from "@/utils/storage";

import type { TrackablePing } from "./position-rules";

import {
  afterFlushAttempt,
  afterFlushForbidden,
  afterFlushSuccess,
  afterSignedOut,
  claimFor,
  classifyBatchFailure,
  ingestInto,
  restoreFrom,
  shouldHaltTracking,
  splitRefused,
  takeFlushBatch,
  type BatchFailure,
  type TrackingState,
} from "./state-rules";

import { settleWithin } from "./settle-within";

/**
 * The one pipeline a fix goes through, whoever noticed it.
 *
 * Tracking happens in two places now — the app in the foreground, and a
 * background task the OS wakes with a batch of locations — and those are two
 * JavaScript contexts. The hook's `useRef` buffer does not exist in the second
 * one, which is exactly where a day's worth of a driver's route would be
 * collected and thrown away.
 *
 * So the state lives in storage rather than in memory: the buffer, the last
 * fix kept (which decides whether a parked truck's next fix is worth anything)
 * and the last flush (which decides when to send). A side effect worth having
 * on its own — before this, killing the app reset the stationary filter and
 * the flush clock, so the first fix after every restart was kept and sent no
 * matter how little had happened.
 *
 * Everything that DECIDES is in `state-rules.ts`, where a test can read it.
 * This file is the I/O around it.
 */
const STATE_KEY = "driver_position_state";

/** The old key, from when only the buffer was persisted. */
const LEGACY_BUFFER_KEY = "driver_position_buffer";

interface RecordResponse {
  data: { stored: number; rejected: number; tracking: boolean };
}

/**
 * Reads and writes run one at a time.
 *
 * Two location callbacks can land while a flush is awaiting the network, and a
 * read-modify-write that interleaves loses whichever finished first.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);

  // Keeps the chain alive after a rejection without swallowing it for the
  // caller, who gets `next` and its error.
  queue = next.then(
    () => undefined,
    () => undefined,
  );

  return next;
}

async function readState(): Promise<TrackingState> {
  const saved = await asyncStorage.getItem<TrackingState>(STATE_KEY);
  const legacy = saved
    ? null
    : await asyncStorage.getItem<TrackablePing[]>(LEGACY_BUFFER_KEY);

  return restoreFrom(saved, legacy);
}

async function writeState(state: TrackingState): Promise<void> {
  await asyncStorage.setItem(STATE_KEY, state);
}

/** Where the auth store persists the signed-in user (see store/auth-store.ts). */
const AUTH_STORE_KEY = "auth-store";

/**
 * Who is signed in, read from storage rather than from the store.
 *
 * The background task is a second JavaScript context where the auth store may
 * never have hydrated; the persisted copy is the one thing both contexts
 * share. Logging out clears it, so a flush after logout finds nobody and sends
 * nothing — the points wait for their owner or are dropped for the next user.
 */
async function currentUserId(): Promise<string | null> {
  const persisted = await asyncStorage.getItem<{
    state?: { user?: { id?: string } | null };
  }>(AUTH_STORE_KEY);

  return persisted?.state?.user?.id ?? null;
}

/** One request carrying a batch of points, with whatever credentials apply. */
type PostPings = (pings: TrackablePing[]) => Promise<RecordResponse>;

/** The ordinary send: the session's token, refreshed when it expires. */
const postWithSession: PostPings = (pings) =>
  apiClient.post<RecordResponse>("/route/positions", { pings });

interface BatchOutcome {
  delivered: number;
  unsent: TrackablePing[];

  /**
   * What leaves the buffer: the points the API took (2xx) and the lone
   * points it refused as invalid. Everything else stays stored.
   */
  settled: TrackablePing[];

  tracking: boolean | null;

  /** Why the batch stopped short, when it did. */
  failure: Exclude<BatchFailure, "invalid"> | null;
}

/**
 * Sends one batch, halving it when the API refuses it as invalid.
 *
 * A 400 is a verdict on the points, not on the moment — sending the same batch
 * again gets the same answer forever. A 403 from the API is a verdict on the
 * phone, and a 401 on the session (`classifyBatchFailure`). Anything else (no
 * signal, 5xx, 429) stops here and hands back what was not sent, in order.
 */
async function sendBatch(
  batch: TrackablePing[],
  post: PostPings,
): Promise<BatchOutcome> {
  const pending = [batch];
  const settled: TrackablePing[] = [];

  let delivered = 0;
  let tracking: boolean | null = null;

  while (pending.length > 0) {
    const piece = pending.shift() as TrackablePing[];

    try {
      const response = await post(piece);

      delivered += piece.length;
      settled.push(...piece);
      tracking = response.data.tracking;
    } catch (error) {
      const failure = classifyBatchFailure(error);

      if (failure === "invalid") {
        const halves = splitRefused(piece);

        if (halves.length === 0) {
          // Settled too: sent again, it gets the same 400 forever.
          settled.push(...piece);

          // Only when it was taken: the point itself is where the driver was
          // (personal data), and these lines reach logcat in production.
          logger.warn(
            "[Tracking] Ponto recusado pela API, descartado",
            piece[0]?.recorded_at,
          );
        }

        pending.unshift(...halves);
        continue;
      }

      return {
        delivered,
        unsent: [piece, ...pending].flat(),
        settled,
        tracking,
        failure,
      };
    }
  }

  return { delivered, unsent: [], settled, tracking, failure: null };
}

/**
 * The flush loop, for one known user and one way of posting.
 *
 * In pieces of at most MAX_FLUSH_BATCH: the buffer can hold more than one
 * request may carry. Each piece STAYS in the stored buffer while its request
 * is in flight and leaves only once the API has settled it: the background
 * task is the context Android kills most, often mid-request, and a piece
 * taken out before its POST was up to two hundred points of the trail gone.
 * A piece that did reach the API before the kill goes out again on the next
 * flush, and the API keeps only one copy of a resent point. Points appended
 * meanwhile (by the other JavaScript context) are newer and stay
 * (`afterFlushAttempt`); a failure mid-way keeps everything not settled for
 * the next flush, in order.
 *
 * Must run inside `serialise`.
 */
async function flushAs(
  userId: string,
  post: PostPings,
): Promise<{ sent: number; stopped: boolean }> {
  const saved = await readState();

  let state = claimFor(saved, userId);

  if (state !== saved) await writeState(state);

  let sent = 0;

  while (state.buffer.length > 0) {
    const sending = takeFlushBatch(state.buffer);

    const outcome = await sendBatch(sending, post);
    const after = await readState();

    sent += outcome.delivered;

    if (outcome.failure === "forbidden") {
      await writeState(afterFlushForbidden(after));

      logger.warn(
        "[Tracking] API recusou as posições deste aparelho; rastreamento parado",
      );

      return { sent, stopped: true };
    }

    if (outcome.failure === "signed-out") {
      await writeState(afterSignedOut(after, outcome.settled));

      return { sent, stopped: true };
    }

    if (outcome.unsent.length > 0) {
      await writeState(afterFlushAttempt(after, outcome.settled));

      logger.warn("[Tracking] Falha ao enviar posições");

      return { sent, stopped: after.stopped };
    }

    state = afterFlushSuccess(
      afterFlushAttempt(after, outcome.settled),
      outcome.tracking ?? !after.stopped,
      Date.now(),
    );

    // No route running any more: what is left has nowhere to go, and kept
    // it would be filed under whatever route starts next.
    if (state.stopped) state = { ...state, buffer: [] };

    await writeState(state);
    await asyncStorage.removeItem(LEGACY_BUFFER_KEY);
  }

  return { sent, stopped: state.stopped };
}

/** Sends what is buffered, oldest first, and obeys the API's verdict. */
async function flush(): Promise<{ sent: number; stopped: boolean }> {
  return serialise(async () => {
    const userId = await currentUserId();

    // Nobody signed in: nothing can be sent as anyone.
    if (!userId) return { sent: 0, stopped: (await readState()).stopped };

    return flushAs(userId, postWithSession);
  });
}

/** How long a logout waits for the route's last stretch to go out. */
const SIGN_OUT_FLUSH_TIMEOUT_MS = 4_000;

/**
 * The last stretch of the route, sent while the session still exists (MOB-24).
 *
 * The flush on the way out used to run after the logout had already cleared
 * the session: it found nobody signed in and sent nothing, and the next
 * driver on the phone discarded the buffer. So the logout calls this FIRST,
 * with the user and the token it is about to throw away.
 *
 * The token goes in the header with `requiresAuth: false`, like the remote
 * logout's own calls: no refresh, and no forced logout triggered from inside
 * a logout. A token that no longer works is a 401 — the points stay for this
 * driver's next sign-in. Bounded, because signing out must not wait on a
 * dead network. Resolves to how many points went out; never rejects.
 */
async function flushBeforeSignOut(input: {
  userId: string | null;
  accessToken: string | null;
  timeoutMs?: number;
}): Promise<number> {
  const { userId, accessToken } = input;

  if (!userId || !accessToken) return 0;

  const timeoutMs = input.timeoutMs ?? SIGN_OUT_FLUSH_TIMEOUT_MS;

  const post: PostPings = (pings) =>
    apiClient.request<RecordResponse>("/route/positions", {
      method: "POST",
      body: { pings },
      requiresAuth: false,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeoutMs,
    });

  const outcome = await settleWithin(
    serialise(async () => {
      const saved = await readState();

      // Nothing of this driver's to send: the logout touches nothing here.
      if (saved.ownerId !== userId || saved.buffer.length === 0) {
        return { sent: 0, stopped: saved.stopped };
      }

      return flushAs(userId, post);
    }),
    timeoutMs,
  );

  return outcome?.sent ?? 0;
}

/**
 * A batch of fixes, from wherever they came.
 *
 * `halt` tells the caller to stop asking the OS for more: the API said the
 * route is over or refused the phone, or nobody is signed in any more
 * (`shouldHaltTracking`).
 */
async function ingest(
  fixes: TrackablePing[],
): Promise<{ kept: number; halt: boolean }> {
  const outcome = await serialise(async () => {
    const userId = await currentUserId();

    // A fix after logout belongs to nobody the API would file it under.
    if (!userId) {
      return { kept: 0, flushNow: false, signedIn: false, stopped: false };
    }

    const result = ingestInto(claimFor(await readState(), userId), fixes);

    await writeState(result.state);

    return {
      kept: result.kept,
      flushNow: result.flushNow,
      signedIn: true,
      stopped: result.state.stopped,
    };
  });

  const stopped = outcome.flushNow ? (await flush()).stopped : outcome.stopped;

  return {
    kept: outcome.kept,
    halt: shouldHaltTracking({ signedIn: outcome.signedIn, stopped }),
  };
}

/** Whether the API has told us to stop following this driver. */
async function isStopped(): Promise<boolean> {
  return serialise(async () => (await readState()).stopped);
}

/**
 * Clears the stop flag when a new route starts.
 *
 * Without it, one completed route would silence the phone for the rest of the
 * day: the flag is what keeps a stale delivery list from restarting tracking,
 * and it has to be lifted by something that knows the day moved on.
 */
async function resume(): Promise<void> {
  await serialise(async () => {
    const state = await readState();

    await writeState({ ...state, stopped: false });
  });
}

export {
  LEGACY_BUFFER_KEY,
  SIGN_OUT_FLUSH_TIMEOUT_MS,
  STATE_KEY,
  flush,
  flushBeforeSignOut,
  ingest,
  isStopped,
  readState,
  resume,
  writeState,
};
