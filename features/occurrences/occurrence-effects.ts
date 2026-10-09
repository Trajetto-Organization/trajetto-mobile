import { queryClient } from "@/providers/query-provider";

import type { MyDeliveriesResponse } from "@/features/deliveries/types";

import { OCCURRENCE_KIND, sentReportOf, withSentReport } from "./authorization-rules";
import { occurrenceTargetOf } from "./occurrence-queue-rules";

/**
 * What a queued occurrence's answer changes on the phone once the queue sends
 * it (`kind-effects`): a request the tower must authorize shows on the stop
 * at once, like one sent at the tap — the queue's refetch that follows may
 * not land on a weak signal, and the stop would say nothing in between.
 */
function rememberSentOccurrence(
  item: {
    kind: string;
    businessId: string;
    endpoint: string;
    body: Record<string, unknown>;
  },
  response: unknown,
): void {
  if (item.kind !== OCCURRENCE_KIND) return;

  const target = occurrenceTargetOf(item.endpoint);
  if (!target) return;

  queryClient.setQueryData<MyDeliveriesResponse>(
    ["my-deliveries", item.businessId],
    (day) =>
      withSentReport(day, {
        deliveryId: target.deliveryId,
        occurrenceTypeId: String(item.body.occurrenceTypeId ?? ""),
        // The send, not the tap: what the server's requestedAt means.
        requestedAt: new Date().toISOString(),
        report: sentReportOf(response),
      }),
  );
}

export { rememberSentOccurrence };
