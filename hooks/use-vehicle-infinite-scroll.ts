import { useCallback, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "../utils/api";
import { parseNDJSON } from "../utils/parseNDJSON";

import { Vehicle } from "../types";

interface FetchVehicleParams {
  pageParam: number;
  signal?: AbortSignal;
  search?: string;
  businessId: string;
}

const fetchVehicles = async ({
  pageParam,
  signal,
  search,
  businessId,
}: FetchVehicleParams): Promise<{ data: Vehicle[]; total: number }> => {
  const MAX_VEHICLE_PAGE = 10;

  try {
    // Build endpoint URL with query parameters
    // Use list-vehicle-business to filter by businessId (works for MASTER, BUSINESS_ADMIN, and drivers)
    let endpoint = `/vehicle/list-vehicle-business?page=${pageParam}&pageSize=${MAX_VEHICLE_PAGE}&businessId=${businessId}`;

    if (search) {
      endpoint += `&search=${encodeURIComponent(search)}`;
    }

    // Note: driverId filtering is now handled automatically by the backend
    // based on the authenticated user's role and driverId

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

    throw new Error(error.message || "Erro ao carregar veículos");
  }
};

export function useVehicleInfiniteScroll(search?: string, businessId?: string) {
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
    queryKey: ["vehicles", search, businessId],
    queryFn: ({ pageParam = 1 }) => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      return fetchVehicles({
        pageParam,
        search,
        businessId: businessId || "", // Require businessId
        signal: abortControllerRef.current.signal,
      });
    },
    enabled: !!businessId, // Only fetch if businessId is provided
    getNextPageParam: (lastPage, allPages) => {
      // Check if there are more vehicles to load
      return lastPage.data.length === 10 ? allPages.length + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Flatten all pages into a single array
  const vehicles = data?.pages.flatMap((page) => page.data) || [];
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
