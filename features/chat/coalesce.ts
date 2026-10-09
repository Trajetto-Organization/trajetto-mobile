import { latestIso } from "./chat-rules";

/**
 * Bursts into single requests (MOB-09).
 *
 * A broadcast, or a driver coming back into signal, lands twenty messages in a
 * second. With the conversation open each one used to post its own
 * `mark-read` and refetch the unread badge twice: twenty POSTs and forty GETs
 * for what is, to the server, one fact. The delivery receipt already solved
 * this with a window (`use-chat-realtime.ts`); these are the same window as
 * reusable pieces, with the timer injectable so the behaviour is tested
 * rather than assumed.
 *
 * The window is a trailing one that the FIRST request opens and later ones
 * never extend: the answer is at most one window late, however long the burst
 * lasts.
 */

interface CoalescerTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const REAL_TIMERS: CoalescerTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Same length as the delivery receipt's: still reads as instantaneous. */
const CHAT_COALESCE_MS = 800;

interface CoalescedTrigger {
  /** Asks for one run; everything asked inside the window shares it. */
  request: () => void;

  /** Drops a run that has not happened yet; says whether there was one. */
  cancel: () => boolean;
}

function createCoalescedTrigger(input: {
  windowMs: number;
  fire: () => void;
  timers?: CoalescerTimers;
}): CoalescedTrigger {
  const timers = input.timers ?? REAL_TIMERS;

  let handle: unknown = null;

  return {
    request() {
      if (handle !== null) return;

      handle = timers.set(() => {
        handle = null;
        input.fire();
      }, input.windowMs);
    },

    cancel() {
      if (handle === null) return false;

      timers.clear(handle);
      handle = null;

      return true;
    },
  };
}

interface CursorCoalescer {
  /** Offers an instant; only the latest of a window is flushed. */
  push: (iso: string) => void;

  /** Drops what has not been flushed yet. */
  cancel: () => void;
}

/**
 * An advance-only cursor, flushed once per window with the LATEST instant
 * pushed into it.
 *
 * An instant at or behind the last one successfully flushed is not worth a
 * request and is dropped. A flush that fails forgets that it happened, so the
 * next push — or the same instant pushed again — gets another chance.
 *
 * `hold` is taken when a window opens and released once that window's flush
 * has settled (or the window was dropped): whatever depends on the cursor
 * having moved — the unread badge — waits for it instead of reading the old
 * value first.
 */
function createCursorCoalescer(input: {
  windowMs: number;
  flush: (iso: string) => Promise<void>;
  hold?: () => () => void;
  timers?: CoalescerTimers;
}): CursorCoalescer {
  const timers = input.timers ?? REAL_TIMERS;

  let handle: unknown = null;
  let pending: string | null = null;
  let flushed: string | null = null;
  let release: (() => void) | null = null;

  const isAhead = (iso: string) =>
    !flushed || new Date(iso).getTime() > new Date(flushed).getTime();

  const takeRelease = () => {
    const current = release;
    release = null;

    return current ?? (() => undefined);
  };

  const fire = () => {
    handle = null;

    const value = pending;
    pending = null;

    const done = takeRelease();

    if (!value || !isAhead(value)) {
      done();
      return;
    }

    const previous = flushed;
    flushed = value;

    void input
      .flush(value)
      .catch(() => {
        // Only roll back if nothing newer was flushed in the meantime.
        if (flushed === value) flushed = previous;
      })
      .finally(done);
  };

  return {
    push(iso) {
      if (!isAhead(iso)) return;

      pending = latestIso(pending, iso);

      if (handle !== null) return;

      release = input.hold?.() ?? null;
      handle = timers.set(fire, input.windowMs);
    },

    cancel() {
      if (handle !== null) timers.clear(handle);

      handle = null;
      pending = null;

      takeRelease()();
    },
  };
}

export { CHAT_COALESCE_MS, createCoalescedTrigger, createCursorCoalescer };
export type { CoalescedTrigger, CoalescerTimers, CursorCoalescer };
