import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuthStore } from "@/store/auth-store";
import { apiClient } from "@/utils/api";

import { hasDeliveriesAccess } from "@/features/access/module-rules";

import { linkedMessagesPreview, type LinkedMessagePreview } from "../chat-context";
import {
  deliveryChatMessagesKey,
  deliveryChatMessagesUrl,
  routeChatMessagesKey,
  routeChatMessagesUrl,
} from "../linked-messages";

import type { ChatMessagesResponse } from "../types";

const NONE: LinkedMessagePreview[] = [];

/**
 * The latest messages about one delivery or route, from the driver's own
 * thread (decision 6.7). Empty when nothing was said about it, offline, or
 * on any failure: the section is a preview, and the chat is one tap away.
 */
function useLinkedChatMessages(
  id: string,
  queryKey: readonly unknown[],
  url: string,
): LinkedMessagePreview[] {
  const user = useAuthStore((state) => state.user);

  const query = useQuery({
    queryKey,
    enabled: Boolean(id) && hasDeliveriesAccess(user),
    queryFn: () => apiClient.get<ChatMessagesResponse>(url),

    // Refreshed by the sends and arrivals themselves (refreshLinkedChatMessages);
    // this only bounds how old a preview can be on reopening.
    staleTime: 30_000,
  });

  const myUserId = user?.id ?? "";
  const page = query.data?.data;

  return useMemo(
    () => (page ? linkedMessagesPreview(page, myUserId) : NONE),
    [page, myUserId],
  );
}

/** What was said about a delivery, for its detail screen. */
function useDeliveryChatMessages(deliveryId: string): LinkedMessagePreview[] {
  return useLinkedChatMessages(
    deliveryId,
    deliveryChatMessagesKey(deliveryId),
    deliveryChatMessagesUrl(deliveryId),
  );
}

/** What was said about a route, for its section of the list. */
function useRouteChatMessages(routeId: string): LinkedMessagePreview[] {
  return useLinkedChatMessages(
    routeId,
    routeChatMessagesKey(routeId),
    routeChatMessagesUrl(routeId),
  );
}

export { useDeliveryChatMessages, useRouteChatMessages };
