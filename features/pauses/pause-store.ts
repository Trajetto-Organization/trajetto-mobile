import AsyncStorage from "@react-native-async-storage/async-storage";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  settledPauseState,
  type LocalPauseState,
  type OpenPause,
  type PauseHandoff,
} from "./pause-rules";

/**
 * The pause this phone knows about, per driver and company, on disk.
 *
 * Written at the tap, before anything is sent: the banner and its timer are
 * the driver's, with or without signal, and they survive the app being killed
 * mid-pause (decision 6.1). The server's `/current` corrects it when nothing
 * of the driver's is still in flight (see `resolvePause`).
 *
 * Kept per user rather than cleared on logout: a start still in the queue
 * belongs to its driver across a logout, and the record that shows it must
 * come back with them. Another driver on the same phone reads another scope.
 */

interface PauseStoreState {
  byScope: Record<string, LocalPauseState>;

  /**
   * The gesture of each scope tapped and not yet sent nor queued. On disk,
   * written in the same step as the record it changes: a process killed
   * mid-handoff leaves it here for the next start to queue
   * (`recoverPauseHandoffs`).
   */
  handoffs: Record<string, PauseHandoff>;

  /**
   * Scopes with a gesture being sent right now by THIS process. Memory only:
   * it is what makes a second tap "busy", and a dead process taps nothing.
   */
  sending: Record<string, boolean>;

  setOpen: (scope: string, open: OpenPause | null, at?: number) => void;
  forgetOpen: (scope: string, startSubmissionId: string, at?: number) => void;
  adopt: (scope: string, open: OpenPause | null, requestedAt: number) => void;

  /** A gesture of the scope is settled with the server (`settledPauseState`). */
  settle: (scope: string, fromQueue: OpenPause | null, at?: number) => void;

  /** The tap's record and its handoff, in one write. Again to add the position. */
  beginHandoff: (
    scope: string,
    open: OpenPause | null,
    handoff: PauseHandoff,
    at?: number,
  ) => void;

  /** The handoff named is sent, queued or refused: nothing left to recover. */
  endHandoff: (scope: string, submissionId: string) => void;

  setSending: (scope: string, sending: boolean) => void;
}

const withoutKey = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...record };
  delete next[key];

  return next;
};

const usePauseStore = create<PauseStoreState>()(
  persist(
    (set) => ({
      byScope: {},
      handoffs: {},
      sending: {},

      setOpen: (scope, open, at = Date.now()) =>
        set((state) => ({
          byScope: { ...state.byScope, [scope]: { open, changedAt: at } },
        })),

      // Only the pause named: a late verdict about an old start must not take
      // away a pause the driver started since.
      forgetOpen: (scope, startSubmissionId, at = Date.now()) =>
        set((state) => {
          const current = state.byScope[scope];

          if (current?.open?.startSubmissionId !== startSubmissionId) return state;

          return {
            byScope: { ...state.byScope, [scope]: { open: null, changedAt: at } },
          };
        }),

      // The server's answer becomes the phone's record, dated when it was
      // asked: a tap after that moment still wins over it.
      adopt: (scope, open, requestedAt) =>
        set((state) => ({
          byScope: { ...state.byScope, [scope]: { open, changedAt: requestedAt } },
        })),

      settle: (scope, fromQueue, at = Date.now()) =>
        set((state) => ({
          byScope: {
            ...state.byScope,
            [scope]: settledPauseState(state.byScope[scope] ?? null, fromQueue, at),
          },
        })),

      beginHandoff: (scope, open, handoff, at = Date.now()) =>
        set((state) => ({
          byScope: { ...state.byScope, [scope]: { open, changedAt: at } },
          handoffs: { ...state.handoffs, [scope]: handoff },
        })),

      endHandoff: (scope, submissionId) =>
        set((state) =>
          state.handoffs[scope]?.submissionId === submissionId
            ? { handoffs: withoutKey(state.handoffs, scope) }
            : state,
        ),

      setSending: (scope, sending) =>
        set((state) => ({ sending: { ...state.sending, [scope]: sending } })),
    }),
    {
      name: "@trajetto:driver-pause:v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ byScope: state.byScope, handoffs: state.handoffs }),

      // Hydrated on demand (`hydratePauseStore`), never at import: the outbox
      // imports this module, and its tests and its first pass must not race a
      // read nobody awaited.
      skipHydration: true,
    },
  ),
);

let hydration: Promise<void> | null = null;

/**
 * The handoffs found on disk when this process read it: left by a process
 * that died mid-handoff. Taken in the same step as the read, before any tap
 * of this process can write one, so a live handoff is never "recovered".
 */
let leftovers: Record<string, PauseHandoff> = {};

/** Reads the record from disk once; every writer awaits this first. */
function hydratePauseStore(): Promise<void> {
  if (hydration) return hydration;
  if (usePauseStore.persist.hasHydrated()) return Promise.resolve();

  hydration = Promise.resolve(usePauseStore.persist.rehydrate())
    .catch(() => undefined)
    .then(() => {
      leftovers = { ...(usePauseStore.getState().handoffs ?? {}) };
    });

  return hydration;
}

/**
 * The leftover handoffs of one driver, handed out once: whoever takes them
 * queues them. Only those still on disk as their scope's handoff.
 */
function takeLeftoverHandoffs(
  userId: string,
): Array<{ scope: string; handoff: PauseHandoff }> {
  const current = usePauseStore.getState().handoffs;
  const taken: Array<{ scope: string; handoff: PauseHandoff }> = [];

  for (const [scope, handoff] of Object.entries(leftovers)) {
    if (handoff.ownerUserId !== userId) continue;

    leftovers = withoutKey(leftovers, scope);

    if (current[scope]?.submissionId === handoff.submissionId) {
      taken.push({ scope, handoff });
    }
  }

  return taken;
}

/** A leftover that could not be queued goes back, for the next attempt. */
function returnLeftoverHandoff(scope: string, handoff: PauseHandoff): void {
  leftovers = { ...leftovers, [scope]: handoff };
}

export {
  hydratePauseStore,
  returnLeftoverHandoff,
  takeLeftoverHandoffs,
  usePauseStore,
};
export type { PauseStoreState };
