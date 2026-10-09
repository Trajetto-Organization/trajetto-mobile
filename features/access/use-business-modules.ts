import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { applyBusinessModules, useAuthStore } from "@/store/auth-store";
import { apiClient } from "@/utils/api";

import { enabledModulesFromEntitlements } from "./module-rules";

/** Also in the offline allowlist: a MASTER offline keeps the last known plan. */
const BUSINESS_ENTITLEMENTS_QUERY_KEY = "business-entitlements";

/**
 * The plan of the company a MASTER is looking at (decision 4.3).
 *
 * `/user/me` answers a MASTER with every module, so the app asks the plan
 * endpoint for the selected company and puts the answer on the session —
 * where every tab, card and screen guard already reads it. Refetched on
 * focus like any query: a MASTER is not in any company's socket room, so
 * `entitlementsChanged` never reaches them.
 *
 * A no-op for everyone else: their `/user/me` already carries their plan.
 */
function useBusinessModules(): {
  isError: boolean;
  retry: () => void;
} {
  const isMaster = useAuthStore((state) => state.user?.role === "MASTER");
  const businessId = useAuthStore((state) => state.user?.businessId ?? null);

  const query = useQuery({
    queryKey: [BUSINESS_ENTITLEMENTS_QUERY_KEY, businessId],
    enabled: isMaster && Boolean(businessId),
    staleTime: 60 * 1000,
    queryFn: ({ signal }) =>
      apiClient.request<unknown>(`/business/entitlements/${businessId}`, {
        method: "GET",
        signal,
      }),
  });

  useEffect(() => {
    if (!isMaster || !businessId || query.data === undefined) return;

    applyBusinessModules(
      businessId,
      enabledModulesFromEntitlements(query.data),
      query.dataUpdatedAt,
    );
  }, [isMaster, businessId, query.data, query.dataUpdatedAt]);

  return {
    isError: query.isError && query.data === undefined,
    retry: () => void query.refetch(),
  };
}

export { BUSINESS_ENTITLEMENTS_QUERY_KEY, useBusinessModules };
