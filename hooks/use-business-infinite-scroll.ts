import { useCallback, useMemo } from "react";
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
  cursor?: string;
  signal?: AbortSignal;
  search?: string;
}

interface FetchBusinessResult {
  data: Business[];
  nextCursor: string | null;
  hasMore: boolean;
}

const BUSINESS_LIMIT = 10;

const fetchBusinesses = async ({
  cursor,
  signal,
  search,
}: FetchBusinessParams): Promise<FetchBusinessResult> => {
  let endpoint = `/business/search-business?limit=${BUSINESS_LIMIT}`;

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

export function useBusinessInfiniteScroll(search = "") {
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
    queryKey: ["businesses", normalizedSearch],
    queryFn: ({ pageParam, signal }) => {
      return fetchBusinesses({
        cursor: pageParam,
        signal,
        search: normalizedSearch || undefined,
      });
    },
    getNextPageParam: (lastPage) => {
      return lastPage.hasMore ? lastPage.nextCursor : undefined;
    },
    initialPageParam: undefined as string | undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const businesses = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data?.pages],
  );
  const total = businesses.length;

  const handleRefetch = useCallback(() => {
    return refetch();
  }, [refetch]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

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
