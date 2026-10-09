import { useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "@/store/auth-store";
import { useOutboxStore } from "@/store/outbox-store";

import type {
  DriverDelivery,
  DriverOccurrenceType,
  MyDeliveriesResponse,
} from "@/features/deliveries/types";

import { authorizationView, type AuthorizationView } from "./authorization-rules";

/**
 * The stop's tower state, from the day's payload and the phone's queue — the
 * same for the delivery screen and the list card.
 *
 * The types say whether a queued report asks the tower, and whether an
 * approval failed the delivery. The delivery screen passes the ones it
 * already holds; the list card does not, so they are read from the cached
 * day it is drawn from (the payload carries both): without them the card
 * said "Ocorrência salva no aparelho" while the screen said "Pedido de
 * autorização salvo no aparelho" for the same report.
 */
function useAuthorizationView(
  delivery: DriverDelivery,
  occurrenceTypes?: readonly DriverOccurrenceType[],
): AuthorizationView | null {
  const queue = useOutboxStore((state) => state.items);
  const businessId = useAuthStore((state) => state.user?.businessId ?? "");
  const queryClient = useQueryClient();

  // Read at render, not subscribed: a new day re-renders every card anyway,
  // since the deliveries come in the same payload as the types.
  const types =
    occurrenceTypes ??
    queryClient.getQueryData<MyDeliveriesResponse>(["my-deliveries", businessId])
      ?.occurrence_types;

  return authorizationView({ delivery, queue, occurrenceTypes: types });
}

export { useAuthorizationView };
