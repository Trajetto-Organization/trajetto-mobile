import { describe, expect, it } from "vitest";

import {
  OFFLINE_QUERY_KEYS,
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

  it("keeps the two lists a MASTER passes through", () => {
    expect(isOfflineQueryKey("drivers")).toBe(true);
    expect(isOfflineQueryKey("businesses")).toBe(true);
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
    expect([...OFFLINE_QUERY_KEYS]).toEqual([
      "my-deliveries",
      "vehicles",
      "vehicle",
      "branches",
      "fuelTypes",
      "drivers",
      "businesses",
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

  it("ignores the rest of the key", () => {
    // Only the first segment names the dataset; the rest is scope.
    expect(shouldPersistQuery(successfulQuery(["vehicles", "a", "b"]))).toBe(
      true,
    );

    expect(shouldPersistQuery(successfulQuery(["chat-threads", "a"]))).toBe(
      false,
    );
  });
});
