import { useQuery } from "@tanstack/react-query";

import { useAuthStore } from "@/store/auth-store";
import { apiClient } from "@/utils/api";

import { hasDeliveriesAccess } from "@/features/deliveries/delivery-rules";
import type { ChatThreadsResponse } from "../types";

/**
 * The hub card's badge: how many SAC messages the driver has not read.
 * Derived on the server from the read cursor — nothing accumulates. Kept
 * fresh by `requestChatUnreadRefresh`, once per burst of arrivals or reads.
 */
function useChatUnread() {
  const user = useAuthStore((state) => state.user);
  const enabled = hasDeliveriesAccess(user);

  const query = useQuery({
    queryKey: ["chat-unread", user?.businessId ?? ""],
    enabled,
    queryFn: () =>
      apiClient.get<ChatThreadsResponse>("/chat/list-threads?page=1&pageSize=1"),
  });

  return {
    hasChatAccess: enabled,
    unreadCount: query.data?.totalUnread ?? 0,
  };
}

export { useChatUnread };
