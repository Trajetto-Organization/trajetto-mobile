import { useCallback, useMemo } from "react";
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
  search?: string;
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
  search,
}: FetchBranchParams): Promise<FetchBranchResult> => {
  let endpoint = `/branch/search-branch-business?limit=${BRANCH_LIMIT}&businessId=${encodeURIComponent(businessId)}`;

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

export function useBranchInfiniteScroll(businessId?: string, search = "") {
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
    queryKey: ["branches", businessId, normalizedSearch],
    queryFn: ({ pageParam, signal }) => {
      return fetchBranches({
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

  const branches = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data?.pages],
  );
  const total = branches.length;

  const handleRefetch = useCallback(() => {
    return refetch();
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
