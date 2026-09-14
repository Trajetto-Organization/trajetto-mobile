/**
 * Which queries survive a dead network, and which are not worth the disk.
 *
 * Pure and import-free so it can be tested: the allowlist is the difference
 * between an app that works in a basement and one that shows an empty screen
 * there, and nothing about it is visible at the call site — a query simply
 * fails to be there, months later, with no error to trace back.
 *
 * It is an allowlist rather than "persist everything" because the cache is
 * written to disk on a throttle: dehydrating result pages nobody reads offline
 * would cost a write on every search keystroke and buy nothing.
 */

/**
 * The first segment of every query key the app must still be able to show with
 * no connection.
 *
 * `my-deliveries` is the one that matters most and was the one missing. It is
 * the driver's working list — the screen the whole offline loop is built
 * around — and without it here the list was never written to disk. A driver
 * opening the app in a basement, or after the process was killed, found
 * nothing: no deliveries, no occurrence vocabulary, nothing to comprove
 * against. The outbox that carries the proof back was working perfectly and
 * had nothing to carry.
 *
 * The rest is the reference data a checklist or a refuelling needs, plus the
 * two lists a MASTER passes through to reach it.
 */
const OFFLINE_QUERY_KEYS = [
  "my-deliveries",
  "vehicles",
  "vehicle",
  "branches",
  "fuelTypes",
  "drivers",
  "businesses",
] as const;

const offlineQueryKeys = new Set<string>(OFFLINE_QUERY_KEYS);

/** Whether the first segment of a query key names something we keep offline. */
function isOfflineQueryKey(key: unknown): boolean {
  return offlineQueryKeys.has(String(key));
}

/**
 * Only successful queries are written. A persisted error would come back on
 * the next cold start as a failure the app never actually suffered, and it
 * would outlive the outage that caused it.
 */
function shouldPersistQuery(query: {
  state: { status: string };
  queryKey: readonly unknown[];
}): boolean {
  return query.state.status === "success" && isOfflineQueryKey(query.queryKey[0]);
}

export { OFFLINE_QUERY_KEYS, isOfflineQueryKey, shouldPersistQuery };
