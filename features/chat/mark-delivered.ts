import { apiClient } from "@/utils/api";

interface MarkDeliveredResponse {
  delivered_at: string;
}

/**
 * Tells the API the device already has the messages in hand — that is what
 * turns the SAC's single check into the grey double check. The driver side
 * shows no "delivered" state of its own (reaching the server IS reaching the
 * base, as far as they are concerned), so nothing on this screen depends on
 * the answer.
 *
 * Fire-and-forget and silent by design: a delivery receipt is worthless once
 * it is late. A failure never becomes a toast, never breaks a screen and
 * never enters the offline outbox — the next arriving message or the next
 * time the driver opens the conversation reconciles the cursor anyway.
 *
 * `deliveredAt` must be the newest server `created_at` actually received,
 * never a local clock: the server clamps a future value back to "now".
 */
async function markChatDelivered(
  threadId: string,
  deliveredAt?: string,
): Promise<void> {
  if (!threadId) return;

  try {
    await apiClient.post<MarkDeliveredResponse>("/chat/mark-delivered", {
      threadId,
      ...(deliveredAt && { deliveredAt }),
    });
  } catch {
    // Deliberately swallowed — see above. Not even a log line: a driver in a
    // tunnel would fill the buffer with noise nobody acts on.
  }
}

export { markChatDelivered };
