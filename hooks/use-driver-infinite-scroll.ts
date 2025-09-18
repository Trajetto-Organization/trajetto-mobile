import { useCallback, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "../utils/api";
import { parseNDJSON } from "../utils/parseNDJSON";

export interface Driver {
  id: string;
  name: string;
  birth_date: string;
  cnh: string;
  cpf: string;
  rg: string;
  cep: string;
  city: string;
  uf: string;
  district: string;
  address: string;
  complement?: string | null;
  number: string;
  businessId: string;
  created_at: string;
  updated_at: string;
}

interface FetchDriverParams {
  pageParam: number;
  signal?: AbortSignal;
  search?: string;
}

const fetchDrivers = async ({
  pageParam,
  signal,
  search,
}: FetchDriverParams): Promise<{ data: Driver[]; total: number }> => {
  const MAX_DRIVER_PAGE = 10;

  try {
    // Build endpoint URL with query parameters
    let endpoint = `/driver/list-driver?page=${pageParam}&pageSize=${MAX_DRIVER_PAGE}`;

    if (search) {
      endpoint += `&search=${encodeURIComponent(search)}`;
    }

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

    throw new Error(error.message || "Erro ao carregar motoristas");
  }
};

export function useDriverInfiniteScroll(search?: string) {
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
    queryKey: ["drivers", search],
    queryFn: ({ pageParam = 1 }) => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      return fetchDrivers({
        pageParam,
        search,
        signal: abortControllerRef.current.signal,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      // Check if there are more drivers to load
      return lastPage.data.length === 10 ? allPages.length + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Flatten all pages into a single array
  const drivers = data?.pages.flatMap((page) => page.data) || [];
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