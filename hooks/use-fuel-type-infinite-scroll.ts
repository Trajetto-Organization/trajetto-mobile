import { useCallback, useRef } from "react";
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
}: FetchFuelTypeParams): Promise<FetchFuelTypeResult> => {
  try {
    let endpoint = `/fuel-type/search-fuel-type-business?limit=${FUEL_TYPE_LIMIT}&businessId=${businessId}`;

    if (cursor) {
      endpoint += `&cursor=${cursor}`;
    }

    const response = await apiClient.getNDJSONResponse(endpoint, signal);
    const { meta, data } = await parseNDJSON(response);

    return {
      data: data || [],
      nextCursor: meta?.searchMeta?.nextCursor || null,
      hasMore: meta?.searchMeta?.hasMore || false,
    };
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw error;
    }

    throw new Error(error.message || "Erro ao carregar tipos de combustível");
  }
};

export function useFuelTypeInfiniteScroll(businessId?: string) {
  const abortControllerRef = useRef<AbortController | null>(null);

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
    queryKey: ["fuelTypes", businessId],
    queryFn: ({ pageParam }) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      return fetchFuelTypes({
        cursor: pageParam,
        businessId: businessId || "",
        signal: abortControllerRef.current.signal,
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

  const fuelTypes = data?.pages.flatMap((page) => page.data) || [];
  const total = fuelTypes.length;

  const handleRefetch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    refetch();
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
