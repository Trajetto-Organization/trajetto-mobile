/**
 * What coming back to the app costs the network (MOB-20).
 *
 * A driver switches to Waze and back dozens of times a day. Every return
 * used to cost a `/user/me`, a socket handshake (three queries on the API),
 * a chat reconciliation, and the realtime lists twice over: once by React
 * Query's focus refetch and again by the socket's reconnection resync a
 * second later. For a ten-second glance at the map, nothing had changed.
 *
 * Two rules take that back, and neither trusts luck:
 *
 * - A short absence keeps the socket. It is paused only after a grace, so
 *   a quick return finds it still connected, and whatever the server sent
 *   meanwhile was received live — no handshake, no resync, no catch-up.
 *   Only then is the session re-check skippable too: security, permission
 *   and module changes all arrive on that socket.
 * - A long absence pauses the socket, and its reconnection resyncs the
 *   realtime lists. Their focus refetch would go out BEFORE the socket is
 *   back, so it is skipped for them: the resync, sent after the room is
 *   rejoined, is the one request that covers the whole gap. A socket that
 *   does not come back in time releases them to HTTP anyway.
 *
 * Pure and import-free: `utils/socket.ts` and the providers read it, and
 * the counts are tested here rather than hoped for.
 */

/**
 * How long a backgrounded app keeps its socket.
 *
 * Bounded by the server, not by taste: Socket.IO drops a client that stops
 * answering pings only `pingTimeout` (20 s by default, which the API keeps)
 * after the ping it missed. Under that, the connection is alive on both ends
 * even if Android froze the app the moment it left — so "still connected"
 * really means "nothing was missed".
 */
const SOCKET_BACKGROUND_GRACE_MS = 20_000;

/**
 * How long the realtime lists wait for the reconnection's resync after a
 * return from a pause before catching up over HTTP anyway.
 */
const RETURN_RESYNC_FALLBACK_MS = 10_000;

/**
 * The query roots every reconnection resync refetches: `["my-deliveries",
 * businessId]` (use-route-realtime) and `["notifications", …]`
 * (use-notifications-realtime).
 */
const RESYNCED_QUERY_ROOTS: readonly string[] = ["my-deliveries", "notifications"];

interface AbsenceFacts {
  /** When the app left the foreground; null if it never has. */
  leftAt: number | null;

  /** Since when the current socket connection has been up; null while down. */
  liveSince: number | null;

  now: number;
}

/**
 * Whether the socket carried the whole of the last absence: connected since
 * before the app left, and back within the grace. Then nothing sent in the
 * meantime was lost, and nothing needs asking again.
 */
function socketCarriedAbsence({ leftAt, liveSince, now }: AbsenceFacts): boolean {
  if (leftAt === null || liveSince === null) return false;

  // Reconnected while away: there was a gap, however short.
  if (liveSince > leftAt) return false;

  return now - leftAt < SOCKET_BACKGROUND_GRACE_MS;
}

/**
 * Whether a query refetches when the app regains focus.
 *
 * `resyncOwed`: the socket was paused and has not reconnected, so a resync
 * is coming for the realtime lists — after the reconnection, which is the
 * only request that covers what was missed until then.
 */
function refetchOnFocus(queryKey: readonly unknown[], resyncOwed: boolean): boolean {
  if (!resyncOwed) return true;

  return !RESYNCED_QUERY_ROOTS.includes(String(queryKey[0]));
}

export {
  RESYNCED_QUERY_ROOTS,
  RETURN_RESYNC_FALLBACK_MS,
  SOCKET_BACKGROUND_GRACE_MS,
  refetchOnFocus,
  socketCarriedAbsence,
};

export type { AbsenceFacts };
