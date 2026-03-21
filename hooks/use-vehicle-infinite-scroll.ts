import { useCallback, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "../utils/api";
import { parseNDJSON } from "../utils/parseNDJSON";

import { Vehicle } from "../types";

interface FetchVehicleParams {
  cursor?: string;
  signal?: AbortSignal;
  businessId: string;
}

interface FetchVehicleResult {
  data: Vehicle[];
  nextCursor: string | null;
  hasMore: boolean;
}

const VEHICLE_LIMIT = 10;

const fetchVehicles = async ({
  cursor,
  signal,
  businessId,
}: FetchVehicleParams): Promise<FetchVehicleResult> => {
  try {
    let endpoint = `/vehicle/search-vehicle-business?limit=${VEHICLE_LIMIT}&businessId=${businessId}`;

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

    throw new Error(error.message || "Erro ao carregar veículos");
  }
};

export function useVehicleInfiniteScroll(businessId?: string) {
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
    queryKey: ["vehicles", businessId],
    queryFn: ({ pageParam }) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      return fetchVehicles({
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

  const vehicles = data?.pages.flatMap((page) => page.data) || [];
  const total = vehicles.length;

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
