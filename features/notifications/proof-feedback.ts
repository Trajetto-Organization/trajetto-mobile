import type { Router } from "expo-router";

import { useAuthStore } from "@/store/auth-store";

import { hasDeliveriesAccess } from "@/features/access/module-rules";

import {
  proofFeedbackFromNotification,
  proofFeedbackFromPush,
  type ProofFeedback,
} from "./proof-feedback-rules";
import {
  hydrateProofFeedbackStore,
  proofFeedbackScope,
  useProofFeedbackStore,
} from "./proof-feedback-store";

/**
 * The three roads a proof warning reaches the phone by (decision 6.9): the
 * socket while the app is open, the push tapped from the tray, and the inbox
 * rows when the list is read. Each files it under the session it arrived in.
 */

function sessionScope(): string | null {
  const user = useAuthStore.getState().user;

  if (!user?.id || !user.businessId) return null;

  return proofFeedbackScope(user.id, user.businessId);
}

async function remember(feedback: ProofFeedback): Promise<void> {
  // Read before waiting for the disk: a logout in between must not file the
  // warning under the next driver's session.
  const scope = sessionScope();

  if (!scope) return;

  await hydrateProofFeedbackStore();

  useProofFeedbackStore.getState().record(scope, feedback);
}

/**
 * A `pushNotification` from the socket: the delivery's id when it was a proof
 * warning, `null` otherwise. Heard live: the API emits the row as it creates
 * it, so its arrival dates it on the phone's clock.
 */
function handleProofFeedbackNotification(
  row: Record<string, unknown>,
): string | null {
  const feedback = proofFeedbackFromNotification(row, { live: true });

  if (!feedback) return null;

  void remember(feedback).catch(() => undefined);

  return feedback.deliveryId;
}

/** The inbox rows of a page just read: the warnings among them. */
function rememberProofFeedbackRows(rows: readonly unknown[]): void {
  const found = rows
    .map((row) =>
      row && typeof row === "object"
        ? proofFeedbackFromNotification(row as Record<string, unknown>)
        : null,
    )
    .filter((feedback): feedback is ProofFeedback => feedback !== null);

  if (found.length === 0) return;

  void (async () => {
    for (const feedback of found) await remember(feedback);
  })().catch(() => undefined);
}

/**
 * A push tapped from the tray: remembered from its own text, so the delivery
 * shows the warning even before the socket or the inbox bring the row. The
 * delivery's id, or `null` when the push is of another kind.
 *
 * `sentAt` is the notification's `date`: on Android, when FCM sent it
 * (`google.sent_time`), the server side's clock like the row's. Without
 * it the push is only opened, not kept: dated by the phone, it would be the
 * one warning whose moment is not the server's, and the rules telling an
 * old photo's warning from a new one compare those moments. The row still
 * brings it.
 */
function rememberProofFeedbackPush(
  content: { title?: unknown; body?: unknown; data?: unknown },
  sentAt: Date | null,
): string | null {
  const feedback = proofFeedbackFromPush(content, sentAt ?? new Date());

  if (!feedback) return null;

  if (sentAt) void remember(feedback).catch(() => undefined);

  return feedback.deliveryId;
}

/**
 * Opens the delivery a warning is about. False when this session cannot open
 * deliveries (Entregas switched off since): the caller falls back to the
 * notifications list.
 *
 * `viaList` puts the day's list under it first (contract: a tapped push opens
 * /deliveries and the delivery), so "back" lands there even on a cold start.
 */
function openProofFeedbackDelivery(
  router: Pick<Router, "navigate">,
  deliveryId: string,
  options: { viaList: boolean },
): boolean {
  if (!hasDeliveriesAccess(useAuthStore.getState().user)) return false;

  if (options.viaList) router.navigate("/deliveries");

  router.navigate({ pathname: "/delivery-detail", params: { id: deliveryId } });

  return true;
}

export {
  handleProofFeedbackNotification,
  openProofFeedbackDelivery,
  rememberProofFeedbackPush,
  rememberProofFeedbackRows,
};
