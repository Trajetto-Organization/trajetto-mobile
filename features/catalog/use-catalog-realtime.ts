import { useEffect } from "react";

import type { Socket } from "socket.io-client";

import { useAuthStore } from "@/store/auth-store";
import { queryClient } from "@/providers/query-provider";

import { RESYNC_JITTER_MS, initializeSocket } from "@/utils/socket";

import { CATALOG_CHANGED_EVENT, catalogQueryKeys } from "./catalog-rules";

/**
 * Pickers and lists that follow the panel's catalog edits live (decision
 * 2.3). Invalidation only: active queries refetch through the API, inactive
 * ones are marked stale for their next mount.
 *
 * Spread over the same window as the reconnection resync: the event reaches
 * every online phone of the company in the same instant, and an occurrence
 * type edit refetches `my-deliveries` (always mounted, the heaviest driver
 * endpoint) on all of them. Edits inside the window share one refetch.
 *
 * No resync on reconnection: an edit missed while the socket was paused is
 * picked up by the list's own refetch on mount and focus, and a catalog is
 * not worth a burst of requests on every return to the app (MOB-20).
 */
function useCatalogRealtime(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const businessId = useAuthStore((state) => state.user?.businessId ?? "");
  const isMaster = useAuthStore((state) => state.user?.role === "MASTER");

  useEffect(() => {
    // A MASTER keeps the company it picked, but its socket never joins that
    // company's room (the API emits catalogChanged to business:<id> only),
    // so a listener would never fire. A session with no company yet has no
    // room either.
    if (!isAuthenticated || !businessId || isMaster) return;

    let disposed = false;
    let boundSocket: Socket | null = null;
    let pending: ReturnType<typeof setTimeout> | null = null;

    // Keyed by the joined key, so repeated edits of one catalog count once.
    const owed = new Map<string, string[]>();

    const flush = () => {
      pending = null;

      const queryKeys = [...owed.values()];
      owed.clear();

      for (const queryKey of queryKeys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    const handleCatalogChanged = (incoming: unknown) => {
      if (disposed) return;

      const queryKeys = catalogQueryKeys(incoming, businessId);
      if (queryKeys.length === 0) return;

      for (const queryKey of queryKeys) owed.set(queryKey.join("\u0000"), queryKey);

      if (!pending) pending = setTimeout(flush, Math.random() * RESYNC_JITTER_MS);
    };

    void initializeSocket()
      .then((socket) => {
        if (disposed) return;

        boundSocket = socket;

        // Removed before adding: a remount must not refetch twice per event.
        socket.off(CATALOG_CHANGED_EVENT, handleCatalogChanged);
        socket.on(CATALOG_CHANGED_EVENT, handleCatalogChanged);
      })
      .catch(() => {
        // The socket provider owns connection retries; pull-to-refresh and
        // the lists' own refetches still reconcile.
      });

    return () => {
      disposed = true;

      if (pending) clearTimeout(pending);
      pending = null;
      owed.clear();

      boundSocket?.off(CATALOG_CHANGED_EVENT, handleCatalogChanged);
    };
  }, [isAuthenticated, businessId, isMaster]);
}

export { useCatalogRealtime };
