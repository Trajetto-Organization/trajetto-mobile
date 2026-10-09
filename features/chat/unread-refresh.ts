import { queryClient } from "@/providers/query-provider";

import { CHAT_COALESCE_MS, createCoalescedTrigger } from "./coalesce";

/**
 * The unread badge, refetched once per burst rather than once per message.
 *
 * Two places move the badge: an arrival anywhere in the app
 * (`useChatRealtime`), and the open conversation advancing the read cursor.
 * Both go through this ONE trigger (MOB-09).
 *
 * With the conversation open, an arrival asks for a refetch AND starts a
 * `mark-read`; a refetch that went out before that POST landed would read
 * the old cursor and be followed by a second one. So the conversation HOLDS
 * the badge while its read cursor is on its way: requests made meanwhile are
 * remembered, and a single refetch goes out once the last hold is released.
 * A burst of twenty messages with the chat open is one `mark-read` and one
 * `GET /chat/list-threads`.
 */
const unreadRefresh = createCoalescedTrigger({
  windowMs: CHAT_COALESCE_MS,
  fire: () => {
    void queryClient.invalidateQueries({ queryKey: ["chat-unread"] });
  },
});

const holds = new Set<object>();

// A refetch was asked for while held.
let owed = false;

function requestChatUnreadRefresh(): void {
  if (holds.size > 0) {
    owed = true;
    return;
  }

  unreadRefresh.request();
}

/**
 * Holds the badge until the returned release is called (once; later calls
 * are no-ops). A refetch already scheduled is taken back and owed instead:
 * it would read the cursor before it moves.
 */
function holdChatUnreadRefresh(): () => void {
  const hold = {};

  holds.add(hold);

  if (unreadRefresh.cancel()) owed = true;

  return () => {
    if (!holds.delete(hold)) return;

    if (holds.size === 0 && owed) {
      owed = false;
      unreadRefresh.request();
    }
  };
}

/**
 * Forgets everything scheduled, owed or held. Meant for logout — a refresh
 * scheduled for a session that is gone is noise — and for test isolation.
 */
function cancelChatUnreadRefresh(): void {
  unreadRefresh.cancel();
  holds.clear();
  owed = false;
}

export {
  cancelChatUnreadRefresh,
  holdChatUnreadRefresh,
  requestChatUnreadRefresh,
};
