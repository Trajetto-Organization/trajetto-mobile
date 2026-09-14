import { useCallback, useMemo } from "react";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { apiClient } from "@/utils/api";
import { parseNDJSON } from "@/utils/parseNDJSON";

interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link?: string | null;
  created_at: string;
}

interface FetchNotificationsResult {
  data: AppNotification[];
  nextCursor: string | null;
  hasMore: boolean;
}

const NOTIFICATIONS_LIMIT = 15;

const UNREAD_COUNT_KEY = ["notifications", "unread-count"] as const;
const LIST_KEY = ["notifications", "list"] as const;

const fetchNotifications = async (
  cursor: string | undefined,
  signal: AbortSignal | undefined,
): Promise<FetchNotificationsResult> => {
  let endpoint = `/notification/stream?limit=${NOTIFICATIONS_LIMIT}&includeRead=true`;

  if (cursor) {
    endpoint += `&cursor=${encodeURIComponent(cursor)}`;
  }

  const response = await apiClient.getNDJSONResponse(endpoint, signal);
  const { meta, data } = await parseNDJSON(response);

  return {
    data: data || [],
    nextCursor: meta?.searchMeta?.nextCursor || null,
    hasMore: meta?.searchMeta?.hasMore || false,
  };
};

/**
 * The bell badge. Kept as its own tiny query so every screen can show the
 * count without paying for the list; a short stale time keeps it honest
 * while the driver moves around the app.
 */
function useUnreadNotificationsCount() {
  const { data } = useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: async ({ signal }) => {
      const result = await apiClient.request<{ count: number }>(
        "/notification/unread-count",
        { method: "GET", signal },
      );

      return result.count ?? 0;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return data ?? 0;
}

function useNotificationsList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isLoading,
    isError,
    refetch,
  } = useInfiniteQuery({
    queryKey: LIST_KEY,
    queryFn: ({ pageParam, signal }) => fetchNotifications(pageParam, signal),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 60_000,
  });

  const notifications = useMemo(
    () => data?.pages.flatMap((page) => page.data) ?? [],
    [data?.pages],
  );

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) void fetchNextPage();
  }, [hasNextPage, isFetching, fetchNextPage]);

  return {
    notifications,
    isLoading,
    isFetching,
    isError,
    hasNextPage,
    loadMore,
    refetch,
  };
}

/**
 * Marks one notification as read, optimistically: the dot disappears on tap
 * and the badge drops immediately, with the server correcting on the next
 * sync if the request ends up failing.
 */
function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) =>
      apiClient.request(`/notification/${notificationId}/read`, {
        method: "PATCH",
      }),

    onMutate: async (notificationId) => {
      queryClient.setQueryData<{
        pages: FetchNotificationsResult[];
        pageParams: unknown[];
      }>(LIST_KEY, (current) => {
        if (!current) return current;

        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            data: page.data.map((notification) =>
              notification.id === notificationId
                ? { ...notification, read: true }
                : notification,
            ),
          })),
        };
      });

      queryClient.setQueryData<number>(UNREAD_COUNT_KEY, (count) =>
        Math.max(0, (count ?? 1) - 1),
      );
    },

    onError: () => {
      // The optimistic guess was wrong — let the server state win.
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
      void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
    },
  });
}

/**
 * Feeds a notification that arrived over the socket into the caches: badge
 * up by one, card prepended to the list. Guarded by id so a reconnect
 * replaying an event can't double-count.
 */
function applyIncomingNotification(
  queryClient: QueryClient,
  incoming: AppNotification,
): void {
  let alreadyKnown = false;

  queryClient.setQueryData<{
    pages: FetchNotificationsResult[];
    pageParams: unknown[];
  }>(LIST_KEY, (current) => {
    if (!current || current.pages.length === 0) return current;

    alreadyKnown = current.pages.some((page) =>
      page.data.some((notification) => notification.id === incoming.id),
    );

    if (alreadyKnown) return current;

    const [first, ...rest] = current.pages;

    return {
      ...current,
      pages: [{ ...first, data: [incoming, ...first.data] }, ...rest],
    };
  });

  if (!alreadyKnown && !incoming.read) {
    queryClient.setQueryData<number>(
      UNREAD_COUNT_KEY,
      (count) => (count ?? 0) + 1,
    );
  }
}

export {
  useUnreadNotificationsCount,
  useNotificationsList,
  useMarkNotificationRead,
  applyIncomingNotification,
};

export type { AppNotification };
