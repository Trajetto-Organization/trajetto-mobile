/**
 * How the unread badge stays honest without polling while the socket is up.
 *
 * Pure, so a test can read it: the hooks in use-notifications*.ts are the I/O
 * around these decisions.
 *
 * The badge used to poll /notification/unread-count every 60 s no matter
 * what — the most frequent request a driver's phone made, for a number that
 * changes a few times a day. Everything that moves it now reaches a connected
 * app over the socket: `pushNotification` for a new one, `notificationsRead`
 * for a read on any device (GAP3-13). Polling is the fallback for when the
 * socket is down, and the reconnection resync covers what was missed.
 */

/**
 * Which tray taps were already acted on, for the life of the process.
 *
 * A tap reaches the app twice — the response listener and, on a cold start,
 * `getLastNotificationResponse` — and the second must not navigate again. The
 * record used to live in a ref of the protected layout, which is remounted
 * by every login: after signing out and back in (another driver, on a shared
 * phone) the same old tap was "new" again and threw the app onto /chat or
 * /notifications (MOB-23). Bounded, so a long-lived process cannot grow it.
 */
function createResponseGate(capacity = 20): { claim: (id: string) => boolean } {
  const handled: string[] = [];

  return {
    claim(id) {
      if (handled.includes(id)) return false;

      handled.push(id);
      if (handled.length > capacity) handled.shift();

      return true;
    },
  };
}

/**
 * The screens a push's `data.url` may name that live in the Entregas tabs.
 * "/route" (a route released or cancelled) opens the day's list: the app
 * has no route screen, a route is a section of that list.
 */
const ENTREGAS_DESTINATIONS: Readonly<Record<string, "/chat" | "/deliveries">> = {
  "/chat": "/chat",
  "/deliveries": "/deliveries",
  "/route": "/deliveries",
};

/**
 * Where a tray tap lands. The payload names its destination — a chat push
 * opens the conversation, a delivery or route push the day's list — but only
 * a session with Entregas has those tabs; anywhere else (the module switched
 * off since the push was sent) the tap would go nowhere, so it opens the
 * notifications list, as does any destination the app does not know.
 */
function pushDestination(
  url: string | undefined,
  hasEntregas: boolean,
): "/chat" | "/deliveries" | "/notifications" {
  if (!hasEntregas || url === undefined) return "/notifications";

  return Object.prototype.hasOwnProperty.call(ENTREGAS_DESTINATIONS, url)
    ? ENTREGAS_DESTINATIONS[url]
    : "/notifications";
}

/** The old poll, kept only for while the socket is not connected. */
const UNREAD_COUNT_FALLBACK_POLL_MS = 60_000;

/** React Query's `refetchInterval` for the badge: false turns polling off. */
function unreadCountRefetchInterval(socketConnected: boolean): number | false {
  return socketConnected ? false : UNREAD_COUNT_FALLBACK_POLL_MS;
}

/**
 * Whether a disconnect should re-arm the fallback poll.
 *
 * React Query only re-evaluates the interval when the query updates, so a
 * lost connection has to nudge it. Not when the app closed the socket itself
 * (going to background, logout — "io client disconnect"): the return to the
 * foreground reconnects and resyncs, and a fetch fired on the way out is
 * wasted.
 */
function disconnectNeedsFallbackPoll(reason: string): boolean {
  return reason !== "io client disconnect";
}

/**
 * The cached list pages with one notification (or, with null, all of them)
 * marked read — what another device just did. Pages nothing changed in are
 * returned as they were.
 */
function markPagesRead<
  Item extends { id: string; read: boolean },
  Page extends { data: Item[] },
>(pages: readonly Page[], notificationId: string | null): Page[] {
  return pages.map((page) => {
    const touches = page.data.some(
      (item) =>
        !item.read && (notificationId === null || item.id === notificationId),
    );

    if (!touches) return page;

    return {
      ...page,
      data: page.data.map((item) =>
        notificationId === null || item.id === notificationId
          ? { ...item, read: true }
          : item,
      ),
    };
  });
}

export {
  UNREAD_COUNT_FALLBACK_POLL_MS,
  createResponseGate,
  disconnectNeedsFallbackPoll,
  pushDestination,
  markPagesRead,
  unreadCountRefetchInterval,
};
