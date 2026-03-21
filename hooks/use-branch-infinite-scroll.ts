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
  cursor?: string;
  signal?: AbortSignal;
  businessId: string;
}

interface FetchBranchResult {
  data: Branch[];
  nextCursor: string | null;
  hasMore: boolean;
}

const BRANCH_LIMIT = 10;

const fetchBranches = async ({
  cursor,
  signal,
  businessId,
}: FetchBranchParams): Promise<FetchBranchResult> => {
  try {
    let endpoint = `/branch/search-branch-business?limit=${BRANCH_LIMIT}&businessId=${businessId}`;

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
    queryFn: ({ pageParam }) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      return fetchBranches({
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

  const branches = data?.pages.flatMap((page) => page.data) || [];
  const total = branches.length;

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
