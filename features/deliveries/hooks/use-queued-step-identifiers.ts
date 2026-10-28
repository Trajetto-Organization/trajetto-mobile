import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  deliveryIdentifiersLabel,
  deliveryOfQueuedStep,
} from "../delivery-identity-rules";
import type { MyDeliveriesResponse } from "../types";

interface QueuedStep {
  businessId: string;
  endpoint: string;
}

/**
 * "Pedido: 4815 · NF-e 162342" for a queued delivery step on the pending
 * screen, or null.
 *
 * The outbox item keeps only its URL and "Entrega para Fulano"; the order
 * code and the invoice come from the delivery in the phone's cached day of
 * the item's own company (the queue lists every company's items). Read from
 * the cache, never fetched: offline is exactly when this screen is opened,
 * and a delivery the cache no longer holds shows no identifier rather than
 * a guessed one.
 */
function useQueuedStepIdentifiers(): (step: QueuedStep) => string | null {
  const queryClient = useQueryClient();

  return useCallback(
    (step: QueuedStep) => {
      const cached = queryClient.getQueryData<MyDeliveriesResponse>([
        "my-deliveries",
        step.businessId,
      ]);
      const delivery = deliveryOfQueuedStep(step.endpoint, cached?.data ?? []);

      return delivery ? deliveryIdentifiersLabel(delivery) : null;
    },
    [queryClient],
  );
}

export { useQueuedStepIdentifiers };
