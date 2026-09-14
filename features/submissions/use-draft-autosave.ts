import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { getOrCreateSubmissionId } from "./submission-id";
import type { DraftEnvelope } from "./draft-store";

/** Long enough to collapse a burst of typing, short enough to survive a crash. */
const AUTOSAVE_DELAY_MS = 500;

interface UseDraftAutosaveInput<TDraft extends DraftEnvelope> {
  storageKey: string;

  /** False until the stored draft has been read back and the form has an owner. */
  isEnabled: boolean;

  /**
   * Called at write time, not at schedule time, so the draft always reflects
   * the form as it is when it actually hits disk.
   */
  buildDraft: (submissionId: string) => TDraft;

  save: (storageKey: string, draft: TDraft) => Promise<void>;

  /** Fired when a save is queued — the screens use it to reveal "discard". */
  onSchedule?: () => void;
}

interface DraftAutosave {
  /** Debounced save. Safe to call on every keystroke. */
  schedule: () => void;

  /** Writes any pending save immediately. */
  flush: () => void;

  /**
   * Stops persisting. Called once the form has been handed off — submitted or
   * queued — so the autosave cannot resurrect a draft that no longer exists.
   */
  release: () => void;

  /** Starts persisting again, after the driver discards and begins afresh. */
  resume: () => void;
}

/**
 * Keeps a half-filled form on disk while it is being filled.
 *
 * A checklist takes several minutes and twenty photos to complete, often
 * standing next to a truck. An app killed in the background at minute eight —
 * by the OS reclaiming memory, or a phone call — must not cost the driver that
 * work. Both submission forms need exactly this, which is why it is one hook
 * and not two copies drifting apart.
 */
function useDraftAutosave<TDraft extends DraftEnvelope>({
  storageKey,
  isEnabled,
  buildDraft,
  save,
  onSchedule,
}: UseDraftAutosaveInput<TDraft>): DraftAutosave {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPersistingRef = useRef<boolean>(true);

  // Held in refs so the timer callback always sees the current versions without
  // the debounce being torn down and rebuilt on every render.
  const buildDraftRef = useRef(buildDraft);
  const saveRef = useRef(save);
  const storageKeyRef = useRef(storageKey);
  const isEnabledRef = useRef(isEnabled);

  useEffect(() => {
    buildDraftRef.current = buildDraft;
    saveRef.current = save;
    storageKeyRef.current = storageKey;
    isEnabledRef.current = isEnabled;
  });

  const write = useCallback(async () => {
    if (!isEnabledRef.current || !isPersistingRef.current) return;

    const key = storageKeyRef.current;
    const submissionId = await getOrCreateSubmissionId(key);

    await saveRef.current(key, buildDraftRef.current(submissionId));
  }, []);

  const schedule = useCallback(() => {
    if (!isEnabled || !isPersistingRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    onSchedule?.();

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void write().catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
  }, [isEnabled, onSchedule, write]);

  const flush = useCallback(() => {
    if (!timerRef.current) return;

    clearTimeout(timerRef.current);
    timerRef.current = null;

    void write().catch(() => undefined);
  }, [write]);

  const release = useCallback(() => {
    isPersistingRef.current = false;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    isPersistingRef.current = true;
  }, []);

  // Leaving the app is the moment a pending save is most likely to be lost, and
  // the moment the OS is most likely to kill the process.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") flush();
    });

    return () => {
      subscription.remove();
      flush();
    };
  }, [flush]);

  return { schedule, flush, release, resume };
}

export { useDraftAutosave };
export type { DraftAutosave, UseDraftAutosaveInput };
