import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The driver's list asks the API only when the company has Entregas (MOB-10).
 *
 * The query was enabled by being a driver alone: a driver of a company
 * without the module took a 403 MODULE_NOT_ENABLED on every mount, focus and
 * reconnection. Worse, the seven-day cache kept serving the last day it had —
 * a route "in progress" that kept the GPS tracking, and actions the API
 * refuses.
 *
 * The hook runs for real outside React; `useQuery` is replaced by one that
 * records its options and answers with a cached day.
 */

vi.mock("react", () => ({
  useMemo: <T,>(factory: () => T) => factory(),
  useEffect: () => undefined,
}));

const queryOptions: Array<{
  enabled?: boolean;
  queryKey: unknown[];
  queryFn?: () => Promise<unknown>;
}> = [];

const CACHED_DAY = {
  data: [
    {
      id: "delivery-1",
      status: "IN_TRANSIT",
      recipient_name: "Maria",
      stops: [
        {
          id: "stop-1",
          sequence: 10,
          status: "PENDING",
          route: { id: "route-1", code: 7, name: null, status: "IN_PROGRESS" },
        },
      ],
    },
  ],
  occurrence_types: [{ id: "type-1", name: "Ausente" }],
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { enabled?: boolean; queryKey: unknown[] }) => {
    queryOptions.push(options);

    // What the persisted cache holds, whether or not the query may run.
    return {
      data: CACHED_DAY,
      error: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      isSuccess: true,
      refetch: async () => undefined,
    };
  },
}));

let sessionUser: Record<string, unknown> | null = null;

// The list's sync reads the cached day for the plan-change notice; the real
// client pulls in React Native.
const sync = vi.hoisted(() => ({
  cached: undefined as unknown,
  answer: null as unknown,
  toasts: [] as Array<{ text2?: string }>,
}));

vi.mock("@/providers/query-provider", () => ({
  queryClient: { getQueryData: () => sync.cached },
}));

vi.mock("react-native-toast-message", () => ({
  default: { show: (toast: { text2?: string }) => sync.toasts.push(toast) },
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: { user: unknown }) => unknown) =>
    selector({ user: sessionUser }),
}));

vi.mock("@/store/outbox-store", () => ({
  useOutboxStore: (selector: (state: { items: unknown[] }) => unknown) =>
    selector({ items: [] }),
}));

vi.mock("@/utils/api", () => ({
  ApiError: class ApiError extends Error {},
  apiClient: { request: async () => sync.answer ?? CACHED_DAY },
}));

vi.mock("@/features/submissions/outbox", () => ({
  unparkOutboxItems: async () => undefined,
}));

let useMyDeliveries: typeof import("@/features/deliveries/hooks/use-my-deliveries").useMyDeliveries;

beforeAll(async () => {
  ({ useMyDeliveries } = await import(
    "@/features/deliveries/hooks/use-my-deliveries"
  ));
});

beforeEach(() => {
  queryOptions.length = 0;
});

const driver = (enabledModules: string[]) => ({
  id: "user-1",
  role: "BUSINESS_USER",
  businessId: "business-1",
  driverId: "driver-1",
  enabledModules,
});

describe("the driver's list and the DELIVERIES module", () => {
  it("does not ask the API for a company without Entregas", () => {
    sessionUser = driver(["FLEET"]);

    useMyDeliveries();

    expect(queryOptions.at(-1)?.enabled).toBe(false);
  });

  it("does not serve the cached day either — no route left 'in progress'", () => {
    sessionUser = driver(["FLEET"]);

    const list = useMyDeliveries();

    expect(list.deliveries).toEqual([]);
    expect(list.inRoute).toEqual([]);
    expect(list.occurrenceTypes).toEqual([]);
    expect(list.hasAccess).toBe(false);
  });

  it("asks, and serves the day, when the module is on", () => {
    sessionUser = driver(["FLEET", "DELIVERIES"]);

    const list = useMyDeliveries();

    expect(queryOptions.at(-1)?.enabled).toBe(true);
    expect(list.deliveries.map((entry) => entry.id)).toEqual(["delivery-1"]);
  });

  it("never asks for someone who is not a driver", () => {
    sessionUser = { ...driver(["DELIVERIES"]), driverId: null, role: "MASTER" };

    useMyDeliveries();

    expect(queryOptions.at(-1)?.enabled).toBe(false);
  });
});

describe("the sync and a released route's plan (route design §6.4)", () => {
  it("tells the driver once when the answer carries a newer plan_version than the cached day", async () => {
    sessionUser = driver(["DELIVERIES"]);
    sync.toasts.length = 0;
    sync.cached = { ...CACHED_DAY, routes: [{ id: "route-1", code: 7, plan_version: 2 }] };
    sync.answer = { ...CACHED_DAY, routes: [{ id: "route-1", code: 7, plan_version: 3 }] };

    useMyDeliveries();
    const answer = await queryOptions.at(-1)?.queryFn?.();

    expect(answer).toBe(sync.answer);
    expect(sync.toasts.map((toast) => toast.text2)).toEqual([
      "A rota 7 foi alterada pelo despachante.",
    ]);

    sync.cached = undefined;
    sync.answer = null;
  });
});
