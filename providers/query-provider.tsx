import type { PropsWithChildren } from "react";

import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";

import { shouldPersistQuery } from "@/features/offline/offline-cache-rules";
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

/**
 * How long the offline cache stays usable.
 *
 * This was fifteen minutes, which quietly meant the app only worked offline for
 * fifteen minutes — a driver opening it after an hour without signal found
 * nothing, not even the vehicle list. A week is the honest figure for reference
 * data that changes rarely, and the API stays the authority: everything here is
 * refetched the moment there is a connection again.
 */
const OFFLINE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new AppQueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      staleTime: 5 * 60 * 1000,

      // Has to reach at least as far as the persisted cache: a query collected
      // from memory is not dehydrated, so a shorter window here would silently
      // shrink the one above back to ten minutes.
      gcTime: OFFLINE_CACHE_MAX_AGE,
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
          // Same reading as the offline banner, deliberately: attached to a
          // network says nothing about reaching anything, and behind a captive
          // portal this used to report online while the banner said otherwise.
          // `isInternetReachable` is null while the probe runs, which counts as
          // online so queries are not paused during startup.
          setOnline(
            !(
              state.isConnected === false || state.isInternetReachable === false
            ),
          ),
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
        maxAge: OFFLINE_CACHE_MAX_AGE,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
      onError={() => queryPersister.removeClient()}
    >
      {children}
    </PersistQueryClientProvider>
  );
};
