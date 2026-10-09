import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A catalog edited in the panel reaches the open pickers (decision 2.3).
 *
 * The API emits `catalogChanged { businessId, entity }` to every login of the
 * company, and the web already listens. The app did not: an occurrence type
 * or a vehicle deactivated in the panel stayed on offer in the driver's
 * picker until the list happened to refetch, and the send failed.
 *
 * The hook runs outside a renderer (`useEffect` captured and run by hand)
 * over a fake socket and a real QueryClient, so the prefix matching and the
 * refetch of an active list are TanStack's own. Timers are fake: the
 * refetch is spread over the resync window, and the tests walk through it.
 */

type Listener = (payload?: unknown) => void;

class FakeSocket {
  listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, payload?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  count(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

const harness = vi.hoisted(() => ({
  socket: null as unknown,
  queryClient: null as unknown,
  runEffect: null as null | (() => void | (() => void)),
  session: {
    isAuthenticated: true,
    user: { businessId: "business-1", role: "DRIVER" } as { businessId: string; role: string } | null,
  },
}));

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    harness.runEffect = effect;
  },
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (select: (state: typeof harness.session) => unknown) =>
    select(harness.session),
}));

vi.mock("@/providers/query-provider", () => ({
  get queryClient() {
    return harness.queryClient;
  },
}));

vi.mock("@/utils/socket", () => ({
  RESYNC_JITTER_MS: 2_000,
  initializeSocket: async () => harness.socket,
}));

const { CATALOG_CHANGED_EVENT, QUERY_ROOTS_BY_ENTITY, catalogQueryKeys } =
  await import("@/features/catalog/catalog-rules");
const { useCatalogRealtime } = await import(
  "@/features/catalog/use-catalog-realtime"
);

const JITTER_MS = 2_000;

/** Promises and zero-delay timers, without reaching the jitter. */
const settle = () => vi.advanceTimersByTimeAsync(0);

/** Past the longest spread the hook may pick. */
const afterSpread = () => vi.advanceTimersByTimeAsync(JITTER_MS);

let socket: FakeSocket;
let queryClient: QueryClient;

const KEYS = {
  fuelTypes: ["fuelTypes", "business-1", ""],
  fuelTypesSearched: ["fuelTypes", "business-1", "diesel"],
  otherTenantFuelTypes: ["fuelTypes", "business-2", ""],
  vehicles: ["vehicles", "business-1", ""],
  vehicle: ["vehicle", "business-1", "vehicle-9"],
  myDeliveries: ["my-deliveries", "business-1"],
  drivers: ["drivers", "business-1", ""],
  branches: ["branches", "business-1", ""],
  notifications: ["notifications", "list"],
} as const;

function seed(): void {
  for (const key of Object.values(KEYS)) queryClient.setQueryData(key, { seeded: true });
}

const invalidated = () =>
  Object.entries(KEYS)
    .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
    .sort();

async function mount(): Promise<() => void> {
  useCatalogRealtime();
  const cleanup = harness.runEffect?.();
  await settle();

  return () => {
    if (typeof cleanup === "function") cleanup();
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);

  socket = new FakeSocket();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  harness.socket = socket;
  harness.queryClient = queryClient;
  harness.runEffect = null;
  harness.session = {
    isAuthenticated: true,
    user: { businessId: "business-1", role: "DRIVER" },
  };

  seed();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("which lists an event makes stale (the rule)", () => {
  it("maps each catalog the app reads to its query roots, scoped to the company", () => {
    expect(catalogQueryKeys({ businessId: "b1", entity: "occurrence_type" }, "b1")).toEqual([
      ["my-deliveries", "b1"],
    ]);
    expect(catalogQueryKeys({ businessId: "b1", entity: "vehicle" }, "b1")).toEqual([
      ["vehicles", "b1"],
      ["vehicle", "b1"],
    ]);
    expect(catalogQueryKeys({ businessId: "b1", entity: "fuel_type" }, "b1")).toEqual([
      ["fuelTypes", "b1"],
    ]);
    expect(catalogQueryKeys({ businessId: "b1", entity: "driver" }, "b1")).toEqual([
      ["drivers", "b1"],
    ]);
    expect(catalogQueryKeys({ businessId: "b1", entity: "branch" }, "b1")).toEqual([
      ["branches", "b1"],
    ]);
  });

  it("ignores catalogs the app never shows", () => {
    for (const entity of [
      "shipper",
      "status_reason",
      "message_template",
      "supplier",
      "part",
      "vehicle_type",
      "profile_access",
    ]) {
      expect(catalogQueryKeys({ businessId: "b1", entity }, "b1")).toEqual([]);
    }

    expect(Object.keys(QUERY_ROOTS_BY_ENTITY).sort()).toEqual([
      "branch",
      "driver",
      "fuel_type",
      "occurrence_type",
      "vehicle",
    ]);
  });

  it("ignores malformed payloads, another company, and Object's own keys", () => {
    expect(catalogQueryKeys(null, "b1")).toEqual([]);
    expect(catalogQueryKeys("vehicle", "b1")).toEqual([]);
    expect(catalogQueryKeys({ entity: "vehicle" }, "b1")).toEqual([]);
    expect(catalogQueryKeys({ businessId: "", entity: "vehicle" }, "")).toEqual([]);
    expect(catalogQueryKeys({ businessId: "b2", entity: "vehicle" }, "b1")).toEqual([]);
    expect(catalogQueryKeys({ businessId: "b1", entity: "vehicle" }, null)).toEqual([]);
    expect(catalogQueryKeys({ businessId: "b1", entity: "constructor" }, "b1")).toEqual([]);
    expect(catalogQueryKeys({ businessId: "b1", entity: "toString" }, "b1")).toEqual([]);
  });
});

describe("the app listening to catalogChanged", () => {
  it("invalidates only that catalog's lists, of that company, searched or not", async () => {
    const unmount = await mount();

    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "fuel_type" });
    await afterSpread();

    expect(invalidated()).toEqual(["fuelTypes", "fuelTypesSearched"]);

    unmount();
  });

  it("refreshes the day's payload when an occurrence type changes (the driver's picker)", async () => {
    const unmount = await mount();

    socket.emit(CATALOG_CHANGED_EVENT, {
      businessId: "business-1",
      entity: "occurrence_type",
    });
    await afterSpread();

    expect(invalidated()).toEqual(["myDeliveries"]);

    unmount();
  });

  it("refreshes both the vehicle list and an open vehicle", async () => {
    const unmount = await mount();

    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "vehicle" });
    await afterSpread();

    expect(invalidated()).toEqual(["vehicle", "vehicles"]);

    unmount();
  });

  it("refetches an open picker once per event", async () => {
    let fetches = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: KEYS.fuelTypes,
      queryFn: async () => {
        fetches += 1;
        return { fetched: fetches };
      },
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => undefined);
    await settle();
    fetches = 0;

    const unmount = await mount();

    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "fuel_type" });
    await afterSpread();

    expect(fetches).toBe(1);

    stop();
    unmount();
  });

  it("does nothing for another company's event or a catalog it does not read", async () => {
    const unmount = await mount();

    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-2", entity: "fuel_type" });
    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "shipper" });
    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1" });
    await afterSpread();

    expect(invalidated()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    unmount();
  });

  it("binds one listener, and none after the session's effect ends", async () => {
    const unmount = await mount();

    expect(socket.count(CATALOG_CHANGED_EVENT)).toBe(1);

    unmount();

    expect(socket.count(CATALOG_CHANGED_EVENT)).toBe(0);

    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "vehicle" });
    await afterSpread();
    expect(invalidated()).toEqual([]);
  });

  it("does not listen before the session has a company", async () => {
    harness.session = { isAuthenticated: true, user: { businessId: "", role: "DRIVER" } };

    const unmount = await mount();

    expect(socket.count(CATALOG_CHANGED_EVENT)).toBe(0);

    unmount();
  });

  it("does not listen for a MASTER, even with the company it picked", async () => {
    // The store keeps the picked company's id for a MASTER, but its socket
    // is never in that company's room: a listener there never fires.
    harness.session = {
      isAuthenticated: true,
      user: { businessId: "business-1", role: "MASTER" },
    };

    const unmount = await mount();

    expect(socket.count(CATALOG_CHANGED_EVENT)).toBe(0);

    unmount();
  });

  it("is mounted for every session in the protected layout", () => {
    const layout = readFileSync(
      resolve(__dirname, "../..", "app/(protected)/_layout.tsx"),
      "utf8",
    );

    const protectedLayout = layout.slice(layout.indexOf("const ProtectedLayout"));

    expect(protectedLayout).toMatch(/useCatalogRealtime\(\);/);
  });
});

/**
 * One edit in the panel reaches every online phone of the company in the
 * same instant. Refetched at once, an occurrence type edit was every driver
 * asking for `my-deliveries` (always mounted, the heaviest driver endpoint)
 * in the same second. The reconnection resync already spreads its refetch
 * over RESYNC_JITTER_MS for this reason; the catalog now does the same.
 */
describe("the whole company refetching at once (thundering herd)", () => {
  it("waits a random share of the resync window before refetching", async () => {
    vi.mocked(Math.random).mockReturnValue(0.75);

    const unmount = await mount();

    socket.emit(CATALOG_CHANGED_EVENT, {
      businessId: "business-1",
      entity: "occurrence_type",
    });

    await vi.advanceTimersByTimeAsync(0.75 * JITTER_MS - 1);
    expect(invalidated()).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(invalidated()).toEqual(["myDeliveries"]);

    unmount();
  });

  it("spreads the phones over the window: each picks its own delay", async () => {
    const delays: number[] = [];

    for (const share of [0, 0.3, 0.99]) {
      vi.mocked(Math.random).mockReturnValue(share);
      queryClient.clear();
      seed();

      const unmount = await mount();
      socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "vehicle" });

      let waited = 0;
      while (invalidated().length === 0 && waited <= JITTER_MS) {
        await vi.advanceTimersByTimeAsync(100);
        waited += 100;
      }

      delays.push(waited);
      unmount();
    }

    // Within the window, and not all in the same instant.
    expect(delays.every((delay) => delay <= JITTER_MS)).toBe(true);
    expect(new Set(delays).size).toBe(3);
  });

  it("lets a burst of edits inside the window cost one refetch", async () => {
    let fetches = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: KEYS.fuelTypes,
      queryFn: async () => {
        fetches += 1;
        return { fetched: fetches };
      },
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => undefined);
    await settle();
    fetches = 0;

    const unmount = await mount();

    // An import in the panel: several fuel types saved one after the other.
    for (let edit = 0; edit < 5; edit += 1) {
      socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "fuel_type" });
      await vi.advanceTimersByTimeAsync(100);
    }

    await afterSpread();

    expect(fetches).toBe(1);

    stop();
    unmount();
  });

  it("still refreshes every catalog named inside the window", async () => {
    const unmount = await mount();

    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "fuel_type" });
    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "branch" });
    await afterSpread();

    expect(invalidated()).toEqual(["branches", "fuelTypes", "fuelTypesSearched"]);

    unmount();
  });

  it("drops the pending refetch when the session's effect ends", async () => {
    const unmount = await mount();

    socket.emit(CATALOG_CHANGED_EVENT, { businessId: "business-1", entity: "vehicle" });
    unmount();

    await afterSpread();

    expect(invalidated()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
