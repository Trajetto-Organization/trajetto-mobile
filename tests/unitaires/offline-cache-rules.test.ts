import { describe, expect, it } from "vitest";

import {
  MAX_PERSISTED_PAGES,
  OFFLINE_QUERY_KEYS,
  PERSISTED_CACHE_BUDGET_CHARS,
  PERSISTED_TOP_QUERY_CEILING_BYTES,
  compactPersistedClient,
  dropLeastValuableQuery,
  isOfflineQueryKey,
  shouldPersistQuery,
} from "../../features/offline/offline-cache-rules";

/**
 * The allowlist decides, invisibly, whether the app works in a basement.
 *
 * `my-deliveries` was missing from it, and nothing said so: the hook's own
 * docblock claimed the list "rides the app's persisted 7-day cache", the
 * outbox that carries proofs back worked perfectly, and the screen was simply
 * empty when it mattered. A bug whose only symptom is absence needs a test
 * that names what must be present.
 */
const successfulQuery = (key: readonly unknown[]) => ({
  state: { status: "success" },
  queryKey: key,
});

describe("what survives a dead network", () => {
  it("keeps the driver's working list", () => {
    // The screen the entire offline loop is built around. Without it the
    // driver has nothing to comprove against — no deliveries, and no
    // occurrence vocabulary, since one payload carries both.
    expect(isOfflineQueryKey("my-deliveries")).toBe(true);
  });

  it("keeps what a checklist and a refuelling need", () => {
    for (const key of ["vehicles", "vehicle", "branches", "fuelTypes"]) {
      expect(isOfflineQueryKey(key)).toBe(true);
    }
  });

  it("keeps what a MASTER passes through", () => {
    expect(isOfflineQueryKey("drivers")).toBe(true);
    expect(isOfflineQueryKey("businesses")).toBe(true);

    // The selected company's plan: without it offline, a MASTER's fleet
    // actions would wait on a request that cannot be made.
    expect(isOfflineQueryKey("business-entitlements")).toBe(true);
  });

  it("is an allowlist, not everything", () => {
    // The cache is written to disk on a throttle, so persisting result pages
    // nobody reads offline costs a write per keystroke and buys nothing.
    expect(isOfflineQueryKey("chat-search")).toBe(false);
    expect(isOfflineQueryKey("notifications")).toBe(false);
    expect(isOfflineQueryKey(undefined)).toBe(false);
  });

  it("keeps the route on the cached path by keeping it inside my-deliveries", () => {
    // The dispatcher's stop order reaches the driver INSIDE the my-deliveries
    // payload, not as a query of its own — which is what makes it survive a
    // cold start with no signal, for free.
    //
    // This pins the structural half of that decision: a future "route" query
    // would render a screen that works online and goes blank in a basement,
    // and it would do so silently, because nothing about it looks wrong until
    // the network is gone.
    expect(isOfflineQueryKey("my-deliveries")).toBe(true);
    expect(isOfflineQueryKey("route")).toBe(false);
    expect(isOfflineQueryKey("route-detail")).toBe(false);
  });

  it("names exactly what it names", () => {
    // Pinned so removing an entry is a decision someone has to make on
    // purpose, rather than a line that vanishes in a refactor.
    // The order is the order of value when space runs out.
    expect([...OFFLINE_QUERY_KEYS]).toEqual([
      "my-deliveries",
      "vehicles",
      "vehicle",
      "branches",
      "fuelTypes",
      "drivers",
      "businesses",
      "business-entitlements",
    ]);
  });
});

describe("which results get written", () => {
  it("writes a query that succeeded", () => {
    expect(shouldPersistQuery(successfulQuery(["my-deliveries", "biz"]))).toBe(
      true,
    );
  });

  it("never writes a failure", () => {
    // A persisted error comes back on the next cold start as a failure the
    // app never suffered, outliving the outage that caused it.
    expect(
      shouldPersistQuery({
        state: { status: "error" },
        queryKey: ["my-deliveries", "biz"],
      }),
    ).toBe(false);
  });

  it("never writes a query still loading", () => {
    expect(
      shouldPersistQuery({
        state: { status: "loading" },
        queryKey: ["my-deliveries", "biz"],
      }),
    ).toBe(false);
  });

  it("reads the dataset from the first segment and the scope from the rest", () => {
    // The company a list belongs to is scope, and kept.
    expect(shouldPersistQuery(successfulQuery(["vehicles", "biz", ""]))).toBe(
      true,
    );
    expect(shouldPersistQuery(successfulQuery(["vehicle", "biz", "v1"]))).toBe(
      true,
    );

    expect(shouldPersistQuery(successfulQuery(["chat-threads", "a"]))).toBe(
      false,
    );
  });

  it("never writes a searched copy of a list", () => {
    /**
     * MOB-22. Every term typed in a search box was persisted as its own copy
     * of the list, pages and all, into the ONE storage row the whole cache
     * lives in. The unsearched list is what offline work needs.
     */
    expect(shouldPersistQuery(successfulQuery(["vehicles", "biz", "abc"]))).toBe(
      false,
    );
    expect(shouldPersistQuery(successfulQuery(["drivers", "biz", "ana"]))).toBe(
      false,
    );
    expect(shouldPersistQuery(successfulQuery(["businesses", "trans"]))).toBe(
      false,
    );
    expect(shouldPersistQuery(successfulQuery(["businesses", ""]))).toBe(true);
    expect(shouldPersistQuery(successfulQuery(["branches", "biz", "  "]))).toBe(
      true,
    );
  });
});

describe("what fits in the one row the cache is written to", () => {
  type Query = {
    queryKey: unknown[];
    state: { data: unknown; dataUpdatedAt: number };
  };

  const vehiclePage = (page: number) => ({
    data: Array.from({ length: 20 }, (_, index) => ({
      id: `vehicle-${page}-${index}`,
      plate: "ABC1D23",
      description: "Caminhão baú com descrição comprida o bastante para pesar",
      brand: "Volvo",
      model: "FH 540",
      current_mileage: 123_456,
      notes: "x".repeat(600),
    })),
    nextCursor: `cursor-${page + 1}`,
    hasMore: true,
  });

  const infiniteList = (key: unknown[], pages: number, at: number): Query => ({
    queryKey: key,
    state: {
      data: {
        pages: Array.from({ length: pages }, (_, page) => vehiclePage(page)),
        pageParams: Array.from({ length: pages }, (_, page) => page || undefined),
      },
      dataUpdatedAt: at,
    },
  });

  const client = (queries: Query[]) => ({
    timestamp: 0,
    buster: "trajetto-offline-cache-v1",
    clientState: { mutations: [] as unknown[], queries },
  });

  const myDeliveries: Query = {
    queryKey: ["my-deliveries", "biz-0"],
    state: {
      data: { data: [{ id: "delivery-1" }], occurrence_types: [] },
      dataUpdatedAt: 1,
    },
  };

  it("stays under the row limit for a MASTER who browsed forty companies", () => {
    // Measured, not guessed: forty vehicle lists of ten pages each.
    const browsed = Array.from({ length: 40 }, (_, company) =>
      infiniteList(["vehicles", `biz-${company}`, ""], 10, 1_000 + company),
    );

    const before = JSON.stringify(client([myDeliveries, ...browsed])).length;
    const compacted = compactPersistedClient(client([...browsed, myDeliveries]));
    const after = JSON.stringify(compacted).length;

    expect(before).toBeGreaterThan(PERSISTED_CACHE_BUDGET_CHARS * 5);
    expect(after).toBeLessThanOrEqual(PERSISTED_CACHE_BUDGET_CHARS + 200);

    // The driver's list is never what gives way.
    expect(compacted.clientState.queries[0].queryKey).toEqual([
      "my-deliveries",
      "biz-0",
    ]);

    // The most recently visited companies are the ones kept.
    const keptCompanies = compacted.clientState.queries
      .slice(1)
      .map((query) => query.queryKey[1]);
    expect(keptCompanies[0]).toBe("biz-39");
  });

  /** A driver's day that serializes to about `chars` characters. */
  const heavyDay = (chars: number, filler = "x"): Query => ({
    queryKey: ["my-deliveries", "biz-0"],
    state: {
      data: {
        // NF-e imports with many cargo items: one delivery's worth of text
        // per entry, as many entries as it takes.
        data: Array.from({ length: Math.ceil(chars / 10_000) }, (_, index) => ({
          id: `delivery-${index}`,
          cargo: filler.repeat(10_000),
        })),
        occurrence_types: [],
      },
      dataUpdatedAt: 1,
    },
  });

  it("keeps a driver's day heavier than the whole budget", () => {
    // The budget used to apply to it like to anything else, and a day past
    // it lost the WHOLE offline list — the one thing the cache is for.
    const day = heavyDay(1_200_000);
    const vehicles = infiniteList(["vehicles", "biz-0", ""], 3, 1_000);

    expect(JSON.stringify(day).length).toBeGreaterThan(PERSISTED_CACHE_BUDGET_CHARS);

    const compacted = compactPersistedClient(client([vehicles, day]));

    expect(compacted.clientState.queries.map((query) => query.queryKey[0])).toEqual([
      "my-deliveries",
    ]);
  });

  it("drops a day that could not be read back, and keeps the rest", () => {
    // Past Android's row window the restore fails and takes the whole cache
    // with it; two bytes a character (accents) get there sooner.
    const day = heavyDay(1_000_000, "ã");
    const vehicles = infiniteList(["vehicles", "biz-0", ""], 3, 1_000);

    expect(new TextEncoder().encode(JSON.stringify(day)).length).toBeGreaterThan(
      PERSISTED_TOP_QUERY_CEILING_BYTES,
    );

    const compacted = compactPersistedClient(client([vehicles, day]));

    expect(compacted.clientState.queries.map((query) => query.queryKey[0])).toEqual([
      "vehicles",
    ]);
  });

  it("keeps only the first pages of a long list", () => {
    const compacted = compactPersistedClient(
      client([infiniteList(["vehicles", "biz", ""], 12, 1)]),
      { budgetChars: Number.MAX_SAFE_INTEGER },
    );

    const data = compacted.clientState.queries[0].state.data as {
      pages: unknown[];
      pageParams: unknown[];
    };

    expect(data.pages).toHaveLength(MAX_PERSISTED_PAGES);
    expect(data.pageParams).toHaveLength(MAX_PERSISTED_PAGES);
  });

  it("drops the least valuable query first when a write is refused", () => {
    const companies: Query = {
      queryKey: ["businesses", ""],
      state: { data: [], dataUpdatedAt: 9_999 },
    };
    const oldDeliveries = { ...myDeliveries, state: { ...myDeliveries.state, dataUpdatedAt: 0 } };

    const retried = dropLeastValuableQuery({
      persistedClient: client([oldDeliveries, companies]),
    });

    // The library's default dropped the OLDEST — here, the driver's list.
    expect(retried?.clientState.queries.map((query) => query.queryKey[0])).toEqual([
      "my-deliveries",
    ]);

    expect(dropLeastValuableQuery({ persistedClient: client([]) })).toBeUndefined();
  });
});
