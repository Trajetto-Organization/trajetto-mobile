import type { PropsWithChildren } from "react";

import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  focusManager,
  onlineManager,
  QueryClient,
} from "@tanstack/react-query";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ApiError } from "../utils/api";

const shouldRetryQuery = (failureCount: number, error: unknown): boolean => {
  if (error instanceof Error && error.name === "AbortError") return false;
  if (error instanceof ApiError) {
    if (error.status >= 400 && error.status < 500 && error.status !== 408) {
      return false;
    }

    return error.isTransient && failureCount < 2;
  }

  return failureCount < 2;
};

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "@trajetto:react-query:offline-v1",
  throttleTime: 1_000,
});

class AppQueryClient extends QueryClient {
  clear(): void {
    super.clear();
    void Promise.resolve(queryPersister.removeClient()).catch(() => undefined);
  }
}

const OFFLINE_QUERY_KEYS = new Set([
  "vehicles",
  "vehicle",
  "branches",
  "fuelTypes",
]);

export const queryClient = new AppQueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      refetchOnReconnect: true,
    },
    // Retrying an unknown mutation can duplicate non-idempotent writes.
    mutations: { retry: false },
  },
});

export async function clearQueryCache(): Promise<void> {
  const cancellation = queryClient.cancelQueries();
  queryClient.clear();

  await Promise.allSettled([cancellation, queryPersister.removeClient()]);
}

export const QueryProvider = ({ children }: PropsWithChildren) => {
  useEffect(
    () =>
      onlineManager.setEventListener((setOnline) =>
        NetInfo.addEventListener((state) =>
          setOnline(state.isConnected === true),
        ),
      ),
    [],
  );

  useEffect(() => {
    if (Platform.OS === "web") return;

    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (status) => {
      focusManager.setFocused(status === "active");
    });

    return () => subscription.remove();
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        buster: "trajetto-offline-cache-v1",
        maxAge: 15 * 60 * 1000,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" &&
            OFFLINE_QUERY_KEYS.has(String(query.queryKey[0])),
        },
      }}
      onError={() => queryPersister.removeClient()}
    >
      {children}
    </PersistQueryClientProvider>
  );
};
