import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "../utils/api";
import { parseNDJSON } from "../utils/parseNDJSON";

export interface FuelType {
  id: string;
  description: string;
  businessId: string;
  created_at: string;
  updated_at: string;
}

interface FetchFuelTypeParams {
  cursor?: string;
  signal?: AbortSignal;
  businessId: string;
  search?: string;
}

interface FetchFuelTypeResult {
  data: FuelType[];
  nextCursor: string | null;
  hasMore: boolean;
}

const FUEL_TYPE_LIMIT = 10;

const fetchFuelTypes = async ({
  cursor,
  signal,
  businessId,
  search,
}: FetchFuelTypeParams): Promise<FetchFuelTypeResult> => {
  let endpoint = `/fuel-type/search-fuel-type-business?limit=${FUEL_TYPE_LIMIT}&businessId=${encodeURIComponent(businessId)}`;

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

export function useFuelTypeInfiniteScroll(businessId?: string, search = "") {
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
    queryKey: ["fuelTypes", businessId, normalizedSearch],
    queryFn: ({ pageParam, signal }) => {
      return fetchFuelTypes({
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

  const fuelTypes = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data?.pages],
  );
  const total = fuelTypes.length;

  const handleRefetch = useCallback(() => {
    return refetch();
  }, [refetch]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  const errorMessage =
    error instanceof Error
      ? error.message
      : "Erro ao carregar tipos de combustível";

  return {
    fuelTypes,
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
