import { queryClient } from "@/providers/query-provider";
import { useOutboxStore } from "@/store/outbox-store";

import { notifyPauseRequiresRoute } from "@/features/pauses/pause-notices";
import {
  PAUSE_START_KIND,
  isPauseOutboxKind,
  openPauseFromQueue,
  pauseScope,
  queuedPauseItems,
} from "@/features/pauses/pause-rules";
import { hydratePauseStore, usePauseStore } from "@/features/pauses/pause-store";
import {
  ON_THE_WAY_KIND,
  confirmedOnTheWayAt,
  onTheWayTarget,
} from "@/features/deliveries/on-the-way-rules";
import {
  hydrateOnTheWayStore,
  onTheWayScope,
  useOnTheWayStore,
} from "@/features/deliveries/on-the-way-store";

import { rememberSentOccurrence } from "@/features/occurrences/occurrence-effects";
import { OCCURRENCE_KIND } from "@/features/occurrences/authorization-rules";
import { DELIVERED_KIND } from "@/features/deliveries/delivered-requirements";

import type { SettledVerdict } from "./kind-refusals";

/**
 * What a sent or settled item changes on the phone beyond leaving the queue,
 * for the kinds whose answer carries state (a pause, "a caminho", an
 * occurrence waiting for the tower).
 *
 * One place for both roads a submission takes — sent at the tap
 * (`submitOrQueue`'s `onSent`) or later by the queue — so the two can never
 * record the same answer differently.
 *
 * The returned promise covers only the phone's own record (local stores),
 * and the queue awaits it BEFORE the item leaves: a screen that sees the item
 * gone must already see what its answer changed. The rereads from the server
 * that follow are never awaited.
 */

interface EffectItem {
  /** The queue's id: the item a settled verdict dropped. */
  id?: string;

  kind: string;
  businessId: string;
  ownerUserId?: string;
  endpoint: string;
  body: Record<string, unknown>;
}

const reread = (queryKey: unknown[]): void => {
  void queryClient.invalidateQueries({ queryKey }).catch(() => undefined);
};

/**
 * The pause gesture is settled with the server: the record keeps what it
 * shows, dated now (`settledPauseState`). Without this, a `/current` answer
 * asked while the gesture was still queued would win the moment the item
 * left the queue, and be adopted to disk.
 */
async function settlePauseRecord(
  item: EffectItem,
  outcome: { dropped: boolean; forgetStart: string | null },
): Promise<void> {
  if (!item.ownerUserId) return;

  await hydratePauseStore();

  const scope = pauseScope(item.ownerUserId, item.businessId);
  const store = usePauseStore.getState();

  if (outcome.forgetStart) store.forgetOpen(scope, outcome.forgetStart);

  // For a phone with no record at all, the queue's word: with the item when
  // it landed (its effect holds), without it when it was dropped.
  const fromQueue = openPauseFromQueue(
    queuedPauseItems(useOutboxStore.getState().items, {
      ownerUserId: item.ownerUserId,
      businessId: item.businessId,
    }).filter((queued) => !outcome.dropped || queued.id !== item.id),
  );

  usePauseStore.getState().settle(scope, fromQueue);
}

/** After the API accepted the item. */
async function afterSubmissionSent(item: EffectItem, response: unknown): Promise<void> {
  // A request for the tower's authorization (decision 6.3) shows on the stop.
  if (item.kind === "delivery-occurrence") {
    rememberSentOccurrence(item, response);
    return;
  }

  // A delivery type that asks the tower (decision 14.3) waits on the stop
  // exactly like an occurrence request; one that applied leaves the list on
  // the reread.
  if (item.kind === DELIVERED_KIND) {
    rememberSentOccurrence({ ...item, kind: OCCURRENCE_KIND }, response);
    reread(["my-deliveries", item.businessId]);
    return;
  }

  if (item.kind === ON_THE_WAY_KIND) {
    const target = onTheWayTarget(item.endpoint);
    if (!target || !item.ownerUserId) return;

    // The API's instant (the tap on its clock); the tap itself when an older
    // API answered without it.
    const tapped = typeof item.body.occurred_at === "string" ? item.body.occurred_at : null;
    const confirmedAt = confirmedOnTheWayAt(response);

    await hydrateOnTheWayStore();
    useOnTheWayStore
      .getState()
      .confirm(onTheWayScope(item.ownerUserId, item.businessId), target.stopId, {
        routeId: target.routeId,
        at: confirmedAt ?? tapped ?? new Date().toISOString(),

        // Only next to the API's instant: the pair is what tells the phone's
        // clock error (`phoneClockSkewMs`).
        ...(confirmedAt && tapped ? { tappedAt: tapped } : {}),
      });

    return;
  }

  if (isPauseOutboxKind(item.kind)) {
    await settlePauseRecord(item, { dropped: false, forgetStart: null });

    // The server now knows the gesture: its next answer may win again.
    reread(["driver-pause", item.businessId]);
  }
}

/** After the queue dropped the item on a refusal its contract calls final. */
async function afterSubmissionSettled(
  item: EffectItem,
  verdict: SettledVerdict,
): Promise<void> {
  if (isPauseOutboxKind(item.kind)) {
    const startKey = item.body.start_submission_id;

    // Nothing was recorded for this start (too old), or another pause is open
    // on the server: the phone stops showing this one and rereads the server.
    // Outside a journey (decision 14.4) nothing was recorded for a start nor
    // for the end that would have created the pause: the phone forgets it.
    const startDidNotHappen =
      (item.kind === PAUSE_START_KIND &&
        (verdict.reason === "too-old" || verdict.reason === "other-pause-open")) ||
      verdict.reason === "requires-route";

    await settlePauseRecord(item, {
      dropped: true,
      forgetStart: startDidNotHappen && typeof startKey === "string" ? startKey : null,
    });

    reread(["driver-pause", item.businessId]);

    // The screen that owns the toasts tells the driver why it is gone.
    if (verdict.reason === "requires-route") notifyPauseRequiresRoute();

    return;
  }

  // The stop moved on (reached, resolved) or the route did: the list reads it.
  if (item.kind === ON_THE_WAY_KIND) reread(["my-deliveries", item.businessId]);
}

export { afterSubmissionSent, afterSubmissionSettled };
export type { EffectItem };
