import { queryClient } from "@/providers/query-provider";

/**
 * A delivery's or a route's own messages, as the app previews them (decision
 * 6.7: the delivery/route shows its messages).
 *
 * Not in the offline cache (`offline-cache-rules`): a conversation read from
 * a week-old disk would pass for today's.
 */

const LINKED_CHAT_ROOT = "chat-linked";

/** Enough to know what was said; the whole thread is one tap away. */
const LINKED_PREVIEW_LIMIT = 3;

function deliveryChatMessagesKey(deliveryId: string): readonly unknown[] {
  return [LINKED_CHAT_ROOT, "delivery", deliveryId];
}

function deliveryChatMessagesUrl(deliveryId: string): string {
  return `/chat/list-messages?limit=${LINKED_PREVIEW_LIMIT}&deliveryId=${encodeURIComponent(deliveryId)}`;
}

function routeChatMessagesKey(routeId: string): readonly unknown[] {
  return [LINKED_CHAT_ROOT, "route", routeId];
}

/** The route's messages include those about its deliveries (the API tags them). */
function routeChatMessagesUrl(routeId: string): string {
  return `/chat/list-messages?limit=${LINKED_PREVIEW_LIMIT}&routeId=${encodeURIComponent(routeId)}`;
}

/**
 * A message about a delivery and/or a route was sent or arrived: their
 * previews are stale. Only an open one refetches; a closed one is marked and
 * asks on its next open.
 */
function refreshLinkedChatMessages(message: {
  deliveryId?: string | null;
  routeId?: string | null;
}): void {
  const keys = [
    message.deliveryId ? deliveryChatMessagesKey(message.deliveryId) : null,
    message.routeId ? routeChatMessagesKey(message.routeId) : null,
  ];

  keys.forEach((queryKey) => {
    if (!queryKey) return;

    void queryClient.invalidateQueries({ queryKey }).catch(() => undefined);
  });
}

/**
 * The driver pulled the deliveries list to refresh: every preview hanging off
 * it (each route's section, each delivery) is stale too. Same rule as above:
 * an open one refetches, a closed one asks on its next open.
 */
function refreshAllLinkedChatMessages(): void {
  void queryClient.invalidateQueries({ queryKey: [LINKED_CHAT_ROOT] }).catch(() => undefined);
}

export {
  LINKED_CHAT_ROOT,
  LINKED_PREVIEW_LIMIT,
  deliveryChatMessagesKey,
  deliveryChatMessagesUrl,
  refreshAllLinkedChatMessages,
  refreshLinkedChatMessages,
  routeChatMessagesKey,
  routeChatMessagesUrl,
};
