import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuthStore } from "@/store/auth-store";
import { useOutboxStore } from "@/store/outbox-store";

import { apiClient, ApiError } from "@/utils/api";
import { unparkOutboxItems } from "@/features/submissions/outbox";

import { groupDriverDeliveries } from "../delivery-rules";
import type { MyDeliveriesResponse } from "../types";

/**
 * The driver's working list, offline-first: the query rides the app's
 * persisted 7-day cache, so the last synced day survives a dead network.
 * One payload carries the deliveries AND the occurrence vocabulary — the
 * same round trip the API was designed to serve.
 */
function useMyDeliveries() {
  const user = useAuthStore((state) => state.user);
  const businessId = user?.businessId ?? "";

  const query = useQuery({
    queryKey: ["my-deliveries", businessId],
    enabled: Boolean(businessId && user?.driverId),
    queryFn: () =>
      apiClient.request<MyDeliveriesResponse>(
        `/delivery/my-deliveries/${businessId}`,
      ),
  });

  const deliveries = useMemo(() => query.data?.data ?? [], [query.data]);
  const occurrenceTypes = query.data?.occurrence_types ?? [];

  const groups = useMemo(
    () => groupDriverDeliveries(deliveries),
    [deliveries],
  );

  // A disabled module is a state of the business, not an error of this
  // screen — it gets its own reading and its own copy.
  const moduleDisabled =
    query.error instanceof ApiError &&
    query.error.code === "MODULE_NOT_ENABLED";

  const hasParkedItems = useOutboxStore((state) =>
    state.items.some((item) => item.status === "parked"),
  );

  // The module answered again: whatever parked while it was off goes back
  // in line. The queue itself has no way to know except by being told.
  useEffect(() => {
    if (query.isSuccess && hasParkedItems) {
      void unparkOutboxItems().catch(() => undefined);
    }
  }, [query.isSuccess, hasParkedItems]);

  return {
    businessId,
    deliveries,
    designated: groups.designated,
    inRoute: groups.inRoute,
    occurrenceTypes,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError && !moduleDisabled,
    error: query.error,
    moduleDisabled,
    refetch: query.refetch,
  };
}

export { useMyDeliveries };
