import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "../utils/api";
import { parseNDJSON } from "../utils/parseNDJSON";

export interface Driver {
  id: string;
  name: string;
  cnh: string;
  branchId: string;
  businessId: string;
  status: string;
  created_at: string;
}

interface FetchDriverParams {
  cursor?: string;
  signal?: AbortSignal;
  businessId: string;
  search?: string;
}

interface FetchDriverResult {
  data: Driver[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DRIVER_LIMIT = 10;

const fetchDrivers = async ({
  cursor,
  signal,
  businessId,
  search,
}: FetchDriverParams): Promise<FetchDriverResult> => {
  let endpoint = `/driver/search-driver-business?limit=${DRIVER_LIMIT}&businessId=${encodeURIComponent(businessId)}`;

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

export function useDriverInfiniteScroll(businessId?: string, search = "") {
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
    queryKey: ["drivers", businessId, normalizedSearch],
    queryFn: ({ pageParam, signal }) => {
      return fetchDrivers({
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

  const drivers = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data?.pages],
  );
  const total = drivers.length;

  const handleRefetch = useCallback(() => {
    return refetch();
  }, [refetch]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  const errorMessage =
    error instanceof Error ? error.message : "Erro ao carregar motoristas";

  return {
    drivers,
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
