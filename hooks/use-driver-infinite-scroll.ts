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
  cursor?: string;
  signal?: AbortSignal;
  businessId: string;
}

interface FetchDriverResult {
  data: Driver[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DRIVER_LIMIT = 10;

const fetchDrivers = async ({
  cursor,
  signal,
  businessId,
}: FetchDriverParams): Promise<FetchDriverResult> => {
  try {
    let endpoint = `/driver/search-driver-business?limit=${DRIVER_LIMIT}&businessId=${businessId}`;

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

    throw new Error(error.message || "Erro ao carregar motoristas");
  }
};

export function useDriverInfiniteScroll(businessId?: string) {
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
    queryKey: ["drivers", businessId],
    queryFn: ({ pageParam }) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      return fetchDrivers({
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

  const drivers = data?.pages.flatMap((page) => page.data) || [];
  const total = drivers.length;

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
