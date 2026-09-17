import { apiClient } from "@/utils/api";
import { logger } from "@/utils/logger";

import { asyncStorage } from "@/utils/storage";

import type { TrackablePing } from "./position-rules";

import {
  afterFlushFailure,
  afterFlushSuccess,
  ingestInto,
  restoreFrom,
  type TrackingState,
} from "./state-rules";

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

/**
 * Sends what is buffered, and obeys the API's verdict.
 *
 * The buffer is cleared BEFORE the request and put back on failure. Points
 * arriving mid-request belong to the next batch: counted in this one they
 * would be sent twice, dropped they would be lost.
 */
async function flush(): Promise<{ sent: number; stopped: boolean }> {
  return serialise(async () => {
    const state = await readState();

    if (state.buffer.length === 0) return { sent: 0, stopped: state.stopped };

    const sending = state.buffer;

    await writeState({ ...state, buffer: [] });

    try {
      const response = await apiClient.post<RecordResponse>(
        "/route/positions",
        { pings: sending },
      );

      const after = await readState();
      const tracking = response.data.tracking;

      await writeState(afterFlushSuccess(after, tracking, Date.now()));
      await asyncStorage.removeItem(LEGACY_BUFFER_KEY);

      return { sent: sending.length, stopped: !tracking };
    } catch (error) {
      const after = await readState();

      await writeState(afterFlushFailure(after, sending));

      logger.warn("[Tracking] Falha ao enviar posições", error);

      return { sent: 0, stopped: after.stopped };
    }
  });
}

/** A batch of fixes, from wherever they came. */
async function ingest(fixes: TrackablePing[]): Promise<{ kept: number }> {
  const outcome = await serialise(async () => {
    const result = ingestInto(await readState(), fixes);

    await writeState(result.state);

    return result;
  });

  if (outcome.flushNow) await flush();

  return { kept: outcome.kept };
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
  STATE_KEY,
  flush,
  ingest,
  isStopped,
  readState,
  resume,
  writeState,
};
