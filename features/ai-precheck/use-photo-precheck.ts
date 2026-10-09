import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuthStore } from "@/store/auth-store";
import {
  TEXT_READER_ENGINE_VERSION,
  isTextReaderAvailable,
  readText,
  type ReadTextResult,
} from "@/modules/text-reader";
import { reportEvent } from "@/utils/telemetry";
import { logger } from "@/utils/logger";

import { canPrecheck } from "./precheck-gate";
import { evaluatePrecheck, type PrecheckInput, type PrecheckReader } from "./evaluate-precheck";
import {
  odometerWarning,
  precheckApplies,
  precheckForSubmit,
  storedPrecheckOf,
  type PrecheckKind,
  type StoredPrecheck,
} from "./device-precheck";
import { MILEAGE_DEBOUNCE_MS, typedMileageOf } from "./odometer-precheck-input";

/**
 * The pre-check of one photo slot on a screen (decision 14.2).
 *
 * Off — nothing called, nothing shown — unless the session has the flag and
 * the binary has the native reader. A result about a photo (or km) replaced
 * since is never shown nor sent; the warning can be dismissed ("Enviar
 * assim") and never blocks the send.
 */
function usePhotoPrecheck(kind: PrecheckKind) {
  const user = useAuthStore((state) => state.user);
  const enabled = canPrecheck(user) && isTextReaderAvailable();

  const [stored, setStored] = useState<StoredPrecheck | null>(null);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  // The latest request: an older read finishing late must not win.
  const latest = useRef<string | null>(null);

  // One OCR per photo: retyping the km compares again, it does not re-read.
  const lastRead = useRef<{ uri: string; read: Promise<ReadTextResult> } | null>(null);

  const reader = useMemo<PrecheckReader>(
    () => ({
      engineVersion: TEXT_READER_ENGINE_VERSION,
      readText: (uri: string) => {
        if (lastRead.current?.uri !== uri) {
          const read = readText(uri);

          lastRead.current = { uri, read };
          // A failed read is not kept: the next attempt reads again.
          read.catch(() => {
            if (lastRead.current?.read === read) lastRead.current = null;
          });
        }

        return lastRead.current.read;
      },
    }),
    [],
  );

  const run = useCallback(
    async (input: Omit<PrecheckInput, "kind">): Promise<void> => {
      if (!enabled) return;

      const key = `${input.photoUri}|${input.mileage ?? ""}`;
      latest.current = key;

      const outcome = await evaluatePrecheck(reader, { ...input, kind });

      if (latest.current !== key) return;

      setStored(outcome.stored);

      // Diagnostics: the outcome and the time, never the text read.
      logger.dev("ai precheck", {
        kind,
        outcome: outcome.stored.result.outcome,
        durationMs: outcome.stored.result.duration_ms,
      });

      if (outcome.failure) {
        reportEvent("ai_precheck_failed", { kind, code: outcome.failure.slice(0, 60) });
      }
    },
    [enabled, kind, reader],
  );

  /** Puts back what a draft kept (dropped when malformed). */
  const restore = useCallback((value: unknown) => {
    setStored(storedPrecheckOf(value));
  }, []);

  /** "Enviar assim": the warning goes away; the send records the override. */
  const dismiss = useCallback(() => {
    setDismissedAt(stored?.result.ran_at ?? null);
  }, [stored]);

  /** The result to show for this photo (and km), unless dismissed. */
  const visibleFor = useCallback(
    (photoUri: string | null | undefined, mileage: number | null = null) =>
      enabled && precheckApplies(stored, photoUri, mileage) && stored.result.ran_at !== dismissedAt
        ? stored.result
        : null,
    [enabled, stored, dismissedAt],
  );

  return { enabled, stored, run, restore, dismiss, visibleFor };
}

/**
 * The odometer pre-check of a fueling or a checklist: the photo against the
 * km typed, re-checked when either changes (the km once it stops moving).
 */
function useOdometerPrecheck(photoUri: string | null | undefined, mileageValue: unknown) {
  const precheck = usePhotoPrecheck("odometer");
  const mileage = typedMileageOf(mileageValue);

  const { enabled, stored, run } = precheck;

  useEffect(() => {
    if (!enabled || !photoUri || mileage === null) return;

    // Restored from the draft, or already checked: nothing to read again.
    if (precheckApplies(stored, photoUri, mileage)) return;

    const timer = setTimeout(() => {
      void run({ photoUri, mileage });
    }, MILEAGE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [enabled, photoUri, mileage, stored, run]);

  return {
    stored,
    restore: precheck.restore,
    dismiss: precheck.dismiss,
    warning: odometerWarning(precheck.visibleFor(photoUri, mileage), mileage),

    /** What the submission carries for the photo and km being sent. */
    payloadFor: (uri: string | null | undefined, km: unknown) =>
      precheckForSubmit(stored, uri, typedMileageOf(km)),
  };
}

export { useOdometerPrecheck, usePhotoPrecheck };
