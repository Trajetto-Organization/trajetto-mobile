import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  PERSISTED_TOP_QUERY_CEILING_BYTES,
  compactPersistedClient,
  dropLeastValuableQuery,
  shouldPersistQuery,
} from "@/features/offline/offline-cache-rules";

/**
 * Edges of the offline cache rules left alive by the 06/10 mutation run: the
 * exact UTF-8 ceiling of the driver's day (every width of character), exact
 * budget fits, and the value order of keys the allowlist does not know.
 */

type Query = { queryKey: readonly unknown[]; state: { data?: unknown; dataUpdatedAt: number } };

const query = (key: string, data: unknown, dataUpdatedAt = 1): Query => ({
  queryKey: [key],
  state: { data, dataUpdatedAt },
});

const client = (queries: Query[]) => ({ clientState: { queries, mutations: [] as unknown[] } });

describe("shouldPersistQuery", () => {
  const success = { status: "success" };

  it("persists a list whose search slot holds no text", () => {
    expect(shouldPersistQuery({ state: success, queryKey: ["vehicles", "b1", null] })).toBe(true);
    expect(shouldPersistQuery({ state: success, queryKey: ["vehicles", "b1", "   "] })).toBe(true);
    expect(shouldPersistQuery({ state: success, queryKey: ["vehicles", "b1", "abc"] })).toBe(false);
  });
});

describe("compactPersistedClient ordering and budget", () => {
  it("keeps a key off the allowlist after every listed one", () => {
    const unknown = query("something-else", "x", 999);
    const businesses = query("businesses", "y", 1);

    const kept = compactPersistedClient(client([unknown, businesses]), { budgetChars: Number.MAX_SAFE_INTEGER })
      .clientState.queries;

    expect(kept).toEqual([businesses, unknown]);
  });

  it("leaves an infinite list of exactly maxPages untouched", () => {
    const list = query("vehicles", { pages: [1, 2, 3], pageParams: [0, 1, 2] });

    const [kept] = compactPersistedClient(client([list]), { maxPages: 3, budgetChars: Number.MAX_SAFE_INTEGER })
      .clientState.queries;

    expect(kept).toBe(list);
  });

  it("keeps a second query that fills the budget exactly", () => {
    const first = query("my-deliveries", "a".repeat(50));
    const second = query("vehicles", "b".repeat(30));
    const budget = JSON.stringify(first).length + JSON.stringify(second).length;

    expect(compactPersistedClient(client([first, second]), { budgetChars: budget }).clientState.queries).toEqual([
      first,
      second,
    ]);
    expect(
      compactPersistedClient(client([first, second]), { budgetChars: budget - 1 }).clientState.queries,
    ).toEqual([first]);
  });
});

describe("the top query's UTF-8 ceiling", () => {
  // One of each width the counter distinguishes, at both ends of each range:
  // 1 byte (U+007F), 2 bytes (U+0080, é, U+07FF), 3 bytes (U+0800, U+FFFF)
  // and 4-byte pairs whose high surrogate is the first (U+D800) and the last
  // (U+DBFF) of its range, an emoji, and two 3-byte characters just past the
  // surrogates (U+E000), which must not be read as the start of a pair.
  const MIX = "\u007f\u0080\u00e9\u07ff\u0800\uffff\ud800\udc00\udbff\udfff\ud83d\ude00\ue000\ue000";

  /** A day whose JSON is exactly `bytes` long in UTF-8. */
  const dayOf = (bytes: number): Query => {
    const bare = query("my-deliveries", MIX);
    const padding = bytes - Buffer.byteLength(JSON.stringify(bare), "utf8");
    const day = query("my-deliveries", MIX + "a".repeat(padding));

    expect(Buffer.byteLength(JSON.stringify(day), "utf8")).toBe(bytes);
    return day;
  };

  it("keeps a day of exactly the ceiling, alone over the budget", () => {
    const day = dayOf(PERSISTED_TOP_QUERY_CEILING_BYTES);

    expect(compactPersistedClient(client([day]), { budgetChars: 10 }).clientState.queries).toEqual([day]);
  });

  it("drops a day one byte past the ceiling", () => {
    const day = dayOf(PERSISTED_TOP_QUERY_CEILING_BYTES + 1);

    expect(compactPersistedClient(client([day]), { budgetChars: 10 }).clientState.queries).toEqual([]);
  });
});

describe("dropLeastValuableQuery", () => {
  it("drops the least valuable and leaves the others in their stored order", () => {
    const businesses = query("businesses", 1);
    const deliveries = query("my-deliveries", 2);
    const vehicles = query("vehicles", 3);

    const after = dropLeastValuableQuery({ persistedClient: client([vehicles, businesses, deliveries]) });

    expect(after?.clientState.queries).toEqual([vehicles, deliveries]);
  });
});
