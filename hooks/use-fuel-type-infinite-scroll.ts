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
  pageParam: number;
  signal?: AbortSignal;
  businessId: string;
}

const fetchFuelTypes = async ({
  pageParam,
  signal,
  businessId,
}: FetchFuelTypeParams): Promise<{ data: FuelType[]; total: number }> => {
  const MAX_FUEL_TYPE_PAGE = 10;

  try {
    // Build endpoint URL with query parameters
    // Use list-fuel-type-business to filter by businessId
    const endpoint = `/fuel-type/list-fuel-type-business?businessId=${businessId}&page=${pageParam}&pageSize=${MAX_FUEL_TYPE_PAGE}`;

    // Use apiClient which handles token refresh automatically
    const response = await apiClient.getNDJSONResponse(endpoint, signal);

    // Parse the NDJSON stream
    const { meta, data } = await parseNDJSON(response);

    return {
      data: data || [],
      total: meta?.total || 0,
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
    queryFn: ({ pageParam = 1 }) => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      return fetchFuelTypes({
        pageParam,
        businessId: businessId || "", // Require businessId
        signal: abortControllerRef.current.signal,
      });
    },
    enabled: !!businessId, // Only fetch if businessId is provided
    getNextPageParam: (lastPage, allPages) => {
      // Check if there are more fuel types to load
      return lastPage.data.length === 10 ? allPages.length + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Flatten all pages into a single array
  const fuelTypes = data?.pages.flatMap((page) => page.data) || [];
  const total = data?.pages[0]?.total || 0;

  const handleRefetch = useCallback(() => {
    // Cancel any ongoing requests
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

  // Get error message
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
