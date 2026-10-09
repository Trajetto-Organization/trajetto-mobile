import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuthStore } from "@/store/auth-store";

import { queryClient } from "@/providers/query-provider";
import { apiClient, ApiError } from "@/utils/api";

import { announcePlanChangesBetween } from "../plan-change-notice";

import { groupDriverDeliveries, hasDeliveriesAccess } from "../delivery-rules";
import type { DriverDelivery, DriverOccurrenceType, MyDeliveriesResponse } from "../types";

const NO_DELIVERIES: DriverDelivery[] = [];
const NO_OCCURRENCE_TYPES: DriverOccurrenceType[] = [];

/**
 * The driver's working list, offline-first: the query rides the app's
 * persisted 7-day cache, so the last synced day survives a dead network.
 * One payload carries the deliveries AND the occurrence vocabulary — the
 * same round trip the API was designed to serve.
 *
 * Gated by the DELIVERIES module, not only by being a driver (MOB-10): a
 * driver of a company without the module took a 403 on every mount, focus
 * and reconnection. And with the module off, the cached day is not served
 * either — it would keep a route "in progress" for the position tracking
 * and offer actions the API refuses.
 */
function useMyDeliveries() {
  const user = useAuthStore((state) => state.user);
  const businessId = user?.businessId ?? "";

  const hasAccess = hasDeliveriesAccess(user);

  const query = useQuery({
    queryKey: ["my-deliveries", businessId],
    enabled: Boolean(businessId) && hasAccess,
    queryFn: async () => {
      // The day as cached (up to 7 days old, design §6.4), read before the
      // answer replaces it: a released route whose plan moved meanwhile is
      // told once, the same toast as the live event.
      const cached = queryClient.getQueryData<MyDeliveriesResponse>([
        "my-deliveries",
        businessId,
      ]);

      const fresh = await apiClient.request<MyDeliveriesResponse>(
        `/delivery/my-deliveries/${businessId}`,
      );

      announcePlanChangesBetween(cached?.routes, fresh?.routes);

      return fresh;
    },
  });

  const deliveries = useMemo(
    () => (hasAccess ? (query.data?.data ?? NO_DELIVERIES) : NO_DELIVERIES),
    [hasAccess, query.data],
  );

  const occurrenceTypes = hasAccess
    ? (query.data?.occurrence_types ?? NO_OCCURRENCE_TYPES)
    : NO_OCCURRENCE_TYPES;

  // Decisions 14.3 and 14.4 (contract 3). Undefined, not empty, on a payload
  // cached before them: "Entregar" then keeps the legacy proof and the pause
  // picker its three fixed natures.
  const deliveredTypes = hasAccess ? query.data?.delivered_types : undefined;
  const pauseTypes = hasAccess ? query.data?.pause_types : undefined;
  const journey = hasAccess ? query.data?.journey : undefined;

  const groups = useMemo(
    () => groupDriverDeliveries(deliveries),
    [deliveries],
  );

  // A disabled module is a state of the business, not an error of this
  // screen — it gets its own reading and its own copy.
  const moduleDisabled =
    query.error instanceof ApiError &&
    query.error.code === "MODULE_NOT_ENABLED";

  // No unparking from here: a successful list says nothing about the module
  // a parked FLEET item needs, and this trigger once looped a refused item
  // (MOB-03). The queue unparks on a server observation of the item's own
  // module (features/access/module-observations).

  return {
    businessId,
    hasAccess,
    deliveries,
    designated: groups.designated,
    inRoute: groups.inRoute,
    occurrenceTypes,
    deliveredTypes,
    pauseTypes,
    journey,
    isLoading: hasAccess && query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError && !moduleDisabled,
    error: query.error,
    moduleDisabled,
    refetch: query.refetch,
  };
}

export { useMyDeliveries };
