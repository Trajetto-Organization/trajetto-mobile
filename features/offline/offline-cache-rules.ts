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
 * no connection — in order of what matters most when space runs out.
 *
 * `my-deliveries` is the one that matters most and was the one missing. It is
 * the driver's working list — the screen the whole offline loop is built
 * around — and without it here the list was never written to disk. A driver
 * opening the app in a basement, or after the process was killed, found
 * nothing: no deliveries, no occurrence vocabulary, nothing to comprove
 * against. The outbox that carries the proof back was working perfectly and
 * had nothing to carry.
 *
 * The rest is the reference data a checklist or a refuelling needs, plus what
 * a MASTER passes through to reach it (the company list and the selected
 * company's plan).
 */
const OFFLINE_QUERY_KEYS = [
  "my-deliveries",
  "vehicles",
  "vehicle",
  "branches",
  "fuelTypes",
  "drivers",
  "businesses",
  "business-entitlements",
] as const;

const offlineQueryKeys = new Set<string>(OFFLINE_QUERY_KEYS);

/**
 * The lists whose key carries a search term, and where (MOB-22).
 *
 * Every term typed used to be persisted as its own copy of the list, pages
 * and all — the unsearched list is what offline work needs, and a search
 * with no connection cannot be answered anyway.
 */
const SEARCH_SEGMENT: Record<string, number> = {
  vehicles: 2,
  drivers: 2,
  branches: 2,
  fuelTypes: 2,
  businesses: 1,
};

/** Whether the first segment of a query key names something we keep offline. */
function isOfflineQueryKey(key: unknown): boolean {
  return offlineQueryKeys.has(String(key));
}

function isSearchedList(queryKey: readonly unknown[]): boolean {
  const index = SEARCH_SEGMENT[String(queryKey[0])];
  if (index === undefined) return false;

  const term = queryKey[index];
  return typeof term === "string" && term.trim().length > 0;
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
  return (
    query.state.status === "success" &&
    isOfflineQueryKey(query.queryKey[0]) &&
    !isSearchedList(query.queryKey)
  );
}

/**
 * The whole cache lives in ONE AsyncStorage value. On Android that is a
 * SQLite row, and reading back a row past ~2 MB fails (CursorWindow) — the
 * restore errors, the provider drops the whole cache, and the app is empty
 * offline exactly when it was full of data (MOB-22). A MASTER browsing
 * companies, each vehicle list paged in, got there.
 *
 * Kept under the row limit even if every character took two bytes.
 */
const PERSISTED_CACHE_BUDGET_CHARS = 1_000_000;

/**
 * The most the single most valuable query may weigh, in UTF-8 bytes: under
 * Android's 2 MiB CursorWindow with room for the row around it. The budget
 * above assumes two bytes a character to stay safe for everything together;
 * a driver's day (NF-e imports with many cargo items, long routes) can pass
 * it and still be read back fine, and dropping it for that lost the whole
 * offline list. Past this ceiling it could not be read back at all, and
 * writing it would take the rest of the cache down with it on restore.
 */
const PERSISTED_TOP_QUERY_CEILING_BYTES = 1_900_000;

/** Pages of an infinite list worth keeping offline: the first screenfuls. */
const MAX_PERSISTED_PAGES = 5;

interface PersistedQueryLike {
  queryKey: readonly unknown[];
  state: { data?: unknown; dataUpdatedAt: number };
}

interface PersistedClientLike<TQuery extends PersistedQueryLike> {
  clientState: { queries: TQuery[]; mutations: unknown[] };
}

/** Lower is kept first; anything off the list goes last. */
function priorityOf(query: PersistedQueryLike): number {
  const index = OFFLINE_QUERY_KEYS.indexOf(
    String(query.queryKey[0]) as (typeof OFFLINE_QUERY_KEYS)[number],
  );

  return index === -1 ? OFFLINE_QUERY_KEYS.length : index;
}

function byValue(a: PersistedQueryLike, b: PersistedQueryLike): number {
  return priorityOf(a) - priorityOf(b) || b.state.dataUpdatedAt - a.state.dataUpdatedAt;
}

function trimPages<TQuery extends PersistedQueryLike>(
  query: TQuery,
  maxPages: number,
): TQuery {
  const data = query.state.data as
    | { pages?: unknown[]; pageParams?: unknown[] }
    | undefined;

  if (!data || !Array.isArray(data.pages) || data.pages.length <= maxPages) {
    return query;
  }

  return {
    ...query,
    state: {
      ...query.state,
      data: {
        ...data,
        pages: data.pages.slice(0, maxPages),
        pageParams: Array.isArray(data.pageParams)
          ? data.pageParams.slice(0, maxPages)
          : data.pageParams,
      },
    },
  };
}

/** UTF-8 length without an encoder (Hermes builds may lack TextEncoder). */
function utf8Length(text: string): number {
  let bytes = 0;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one 4-byte character.
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }

  return bytes;
}

/**
 * What actually goes to disk: infinite lists cut to their first pages, then
 * queries in order of value (the driver's deliveries first, the company list
 * last; the freshest first within a kind) for as long as they fit the budget.
 * What does not fit is simply not kept offline — never the whole cache.
 *
 * The most valuable query is the exception: it is kept whenever it can be
 * read back at all (PERSISTED_TOP_QUERY_CEILING_BYTES), even alone over the
 * budget — the rest then gets whatever budget it leaves, possibly none.
 */
function compactPersistedClient<
  TQuery extends PersistedQueryLike,
  TClient extends PersistedClientLike<TQuery>,
>(
  client: TClient,
  options: { budgetChars?: number; maxPages?: number } = {},
): TClient {
  const budget = options.budgetChars ?? PERSISTED_CACHE_BUDGET_CHARS;
  const maxPages = options.maxPages ?? MAX_PERSISTED_PAGES;

  const candidates = client.clientState.queries
    .map((query) => trimPages(query, maxPages))
    .sort(byValue);

  const kept: TQuery[] = [];
  let used = 0;

  candidates.forEach((query, index) => {
    const serialized = JSON.stringify(query);
    const size = serialized.length;

    const fits =
      used + size <= budget ||
      (index === 0 && utf8Length(serialized) <= PERSISTED_TOP_QUERY_CEILING_BYTES);

    if (!fits) return;

    kept.push(query);
    used += size;
  });

  return {
    ...client,
    clientState: { ...client.clientState, queries: kept },
  };
}

/**
 * When the storage refuses a write anyway, drop the least valuable query and
 * try again — not the oldest one (the library's default), which is as likely
 * to be the driver's deliveries as anything else.
 */
function dropLeastValuableQuery<
  TQuery extends PersistedQueryLike,
  TClient extends PersistedClientLike<TQuery>,
>({ persistedClient }: { persistedClient: TClient }): TClient | undefined {
  const queries = persistedClient.clientState.queries;
  if (queries.length === 0) return undefined;

  const leastValuable = [...queries].sort(byValue)[queries.length - 1];

  return {
    ...persistedClient,
    clientState: {
      ...persistedClient.clientState,
      queries: queries.filter((query) => query !== leastValuable),
    },
  };
}

export {
  MAX_PERSISTED_PAGES,
  OFFLINE_QUERY_KEYS,
  PERSISTED_CACHE_BUDGET_CHARS,
  PERSISTED_TOP_QUERY_CEILING_BYTES,
  compactPersistedClient,
  dropLeastValuableQuery,
  isOfflineQueryKey,
  shouldPersistQuery,
};
