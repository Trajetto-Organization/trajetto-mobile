import { useCallback, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "../utils/api";
import { parseNDJSON } from "../utils/parseNDJSON";

export interface Business {
  id: string;
  corporate_reason: string;
  fantasy_name?: string | null;
  cep: string;
  city: string;
  uf: string;
  street: string;
  address_number: string;
  cnpj: string;
  complement?: string | null;
  cnae: string;
  erp_code?: string | null;
  responsible_name: string;
  telephone: string;
  email: string;
  created_at: string;
  updated_at: string;
}

interface FetchBusinessParams {
  pageParam: number;
  signal?: AbortSignal;
  search?: string;
}

const fetchBusinesses = async ({
  pageParam,
  signal,
  search,
}: FetchBusinessParams): Promise<{ data: Business[]; total: number }> => {
  const MAX_BUSINESS_PAGE = 10;

  try {
    // Build endpoint URL with query parameters
    let endpoint = `/business/list-business?page=${pageParam}&pageSize=${MAX_BUSINESS_PAGE}`;

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

    throw new Error(error.message || "Erro ao carregar empresas");
  }
};

export function useBusinessInfiniteScroll(search?: string) {
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
    queryKey: ["businesses", search],
    queryFn: ({ pageParam = 1 }) => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      return fetchBusinesses({
        pageParam,
        search,
        signal: abortControllerRef.current.signal,
      });
    },
    getNextPageParam: (lastPage, allPages) => {
      // Check if there are more businesses to load
      return lastPage.data.length === 10 ? allPages.length + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Flatten all pages into a single array
  const businesses = data?.pages.flatMap((page) => page.data) || [];
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
    error instanceof Error ? error.message : "Erro ao carregar empresas";

  return {
    businesses,
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
