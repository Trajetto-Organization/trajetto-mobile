import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "../utils/api";
import { parseNDJSON } from "../utils/parseNDJSON";

import { Vehicle } from "../types";

interface FetchVehicleParams {
  cursor?: string;
  signal?: AbortSignal;
  businessId: string;
  search?: string;
}

interface FetchVehicleResult {
  data: Vehicle[];
  nextCursor: string | null;
  hasMore: boolean;
}

const VEHICLE_LIMIT = 10;

const fetchVehicles = async ({
  cursor,
  signal,
  businessId,
  search,
}: FetchVehicleParams): Promise<FetchVehicleResult> => {
  let endpoint = `/vehicle/search-vehicle-business?limit=${VEHICLE_LIMIT}&businessId=${encodeURIComponent(businessId)}`;

  if (cursor) {
    endpoint += `&cursor=${encodeURIComponent(cursor)}`;
  }

  if (search) {
    endpoint += `&search=${encodeURIComponent(search)}`;
  }

  const response = await apiClient.getNDJSONResponse(endpoint, signal);
  const { meta, data } = await parseNDJSON(response);

  return {
    data: data || [],
    nextCursor: meta?.searchMeta?.nextCursor || null,
    hasMore: meta?.searchMeta?.hasMore || false,
  };
};

export function useVehicleInfiniteScroll(businessId?: string, search = "") {
  const normalizedSearch = search.trim();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isLoading,
    isError,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["vehicles", businessId, normalizedSearch],
    queryFn: ({ pageParam, signal }) => {
      return fetchVehicles({
        cursor: pageParam,
        businessId: businessId || "",
        signal,
        search: normalizedSearch || undefined,
      });
    },
    enabled: !!businessId,
    getNextPageParam: (lastPage) => {
      return lastPage.hasMore ? lastPage.nextCursor : undefined;
    },
    initialPageParam: undefined as string | undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const vehicles = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data?.pages],
  );
  const total = vehicles.length;

  const handleRefetch = useCallback(() => {
    return refetch();
  }, [refetch]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  const errorMessage =
    error instanceof Error ? error.message : "Erro ao carregar veículos";

  return {
    vehicles,
    total,
    isLoading,
    isFetching,
    isError,
    error: errorMessage,
    hasNextPage,
    loadMore,
    refetch: handleRefetch,
  };
}
