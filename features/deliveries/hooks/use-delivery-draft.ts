import { useCallback, useEffect, useRef, useState } from "react";

import { getOrCreateSubmissionId } from "@/features/submissions/submission-id";
import { useDraftAutosave } from "@/features/submissions/use-draft-autosave";

import { clearDeliveryDraft, recoverDeliveryCapture } from "../delivery-draft";
import {
  deliveryDraftKey,
  type DeliveryDraftKind,
} from "../delivery-draft-rules";

interface UseDeliveryDraftInput<TDraft extends { submissionId: string }> {
  kind: DeliveryDraftKind;
  userId: string | null;
  businessId: string;
  deliveryId: string | null;

  load: (key: string) => Promise<TDraft | null>;
  save: (key: string, draft: TDraft) => Promise<void>;

  /** The draft as the screen holds it now; called at write time. */
  build: (submissionId: string) => TDraft;

  /** Puts a stored draft back on screen. */
  restore: (draft: TDraft) => void;
}

interface DeliveryDraft {
  /** False until the stored draft (if any) is back on screen. */
  isReady: boolean;

  /** Debounced save; safe on every keystroke. */
  schedule: () => void;

  /** Saves now — after a photo, which is the expensive part to lose. */
  saveNow: () => void;

  /** The id the files live under and the API dedupes on. */
  submissionId: () => Promise<string>;

  /** The work left the screen (sent or queued): the draft goes. */
  finish: (submissionId: string) => Promise<void>;
}

/**
 * A proof or occurrence kept on disk while it is being filled (MOB-12).
 *
 * On mount, a photo the camera took while the app was being killed goes into
 * its draft first, then the draft comes back on screen. The submission id is
 * the draft's for its whole life, so the files have one directory and a send
 * repeated after a crash is the same submission to the API.
 */
function useDeliveryDraft<TDraft extends { submissionId: string }>({
  kind,
  userId,
  businessId,
  deliveryId,
  load,
  save,
  build,
  restore,
}: UseDeliveryDraftInput<TDraft>): DeliveryDraft {
  const key =
    userId && businessId && deliveryId
      ? deliveryDraftKey(kind, userId, businessId, deliveryId)
      : null;

  const [isReady, setIsReady] = useState<boolean>(false);

  const autosave = useDraftAutosave<TDraft>({
    storageKey: key ?? "",
    isEnabled: isReady && key !== null,
    buildDraft: build,
    save,
  });

  // The latest callbacks, without re-running the restore when they change:
  // re-running it would load the stored draft over what the driver typed.
  const loadRef = useRef(load);
  const restoreRef = useRef(restore);

  useEffect(() => {
    loadRef.current = load;
    restoreRef.current = restore;
  });

  useEffect(() => {
    if (!key || !userId) return;

    let cancelled = false;

    setIsReady(false);
    autosave.resume();

    void (async () => {
      await recoverDeliveryCapture(userId).catch(() => null);

      const stored = await loadRef.current(key);

      if (stored && !cancelled) restoreRef.current(stored);
    })()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsReady(true);
      });

    return () => {
      cancelled = true;
    };
    // `autosave` is stable across renders (its callbacks are memoised).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId]);

  const saveNow = useCallback(() => {
    autosave.schedule();
    autosave.flush();
  }, [autosave]);

  const submissionId = useCallback(async () => {
    if (!key) throw new Error("Sessão encerrada.");

    return getOrCreateSubmissionId(key);
  }, [key]);

  const finish = useCallback(
    async (id: string) => {
      autosave.release();

      if (key) await clearDeliveryDraft(kind, key, id).catch(() => undefined);
    },
    [autosave, key, kind],
  );

  return {
    isReady,
    schedule: autosave.schedule,
    saveNow,
    submissionId,
    finish,
  };
}

export { useDeliveryDraft };
export type { DeliveryDraft };
