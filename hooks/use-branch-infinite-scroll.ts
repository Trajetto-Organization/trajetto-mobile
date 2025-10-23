import { useCallback, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "../utils/api";
import { parseNDJSON } from "../utils/parseNDJSON";

export interface Branch {
  id: string;
  corporate_reason: string;
  fantasy_name?: string | null;
  cnpj: string;
  email: string;
  phone: string;
  cep: string;
  city: string;
  uf: string;
  district: string;
  address: string;
  complement?: string | null;
  number: string;
  erp_code?: string | null;
  businessId: string;
  created_at: string;
  updated_at: string;
}

interface FetchBranchParams {
  pageParam: number;
  signal?: AbortSignal;
  businessId: string;
}

const fetchBranches = async ({
  pageParam,
  signal,
  businessId,
}: FetchBranchParams): Promise<{ data: Branch[]; total: number }> => {
  const MAX_BRANCH_PAGE = 10;

  try {
    // Build endpoint URL with query parameters
    // Use list-branch-business to filter by businessId
    const endpoint = `/branch/list-branch-business?businessId=${businessId}&page=${pageParam}&pageSize=${MAX_BRANCH_PAGE}`;

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

    throw new Error(error.message || "Erro ao carregar filiais");
  }
};

export function useBranchInfiniteScroll(businessId?: string) {
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
    queryKey: ["branches", businessId],
    queryFn: ({ pageParam = 1 }) => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      return fetchBranches({
        pageParam,
        businessId: businessId || "", // Require businessId
        signal: abortControllerRef.current.signal,
      });
    },
    enabled: !!businessId, // Only fetch if businessId is provided
    getNextPageParam: (lastPage, allPages) => {
      // Check if there are more branches to load
      return lastPage.data.length === 10 ? allPages.length + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Flatten all pages into a single array
  const branches = data?.pages.flatMap((page) => page.data) || [];
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
    error instanceof Error ? error.message : "Erro ao carregar filiais";

  return {
    branches,
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
