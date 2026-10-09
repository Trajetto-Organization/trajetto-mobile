import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A released route changed by the dispatcher (route design §6.3 and §6.4).
 *
 * Live: `routeEvent` `route.stops_changed` reaches the driver's room and the
 * app says so in a toast. Offline: `my-deliveries` carries
 * `routes[].plan_version`, and a sync that finds a newer version than the
 * cached day says the same thing, once. The two roads share one record, so
 * the refetch the socket itself triggers does not repeat the toast.
 *
 * The hook runs outside a renderer: `useEffect` is captured and run by hand.
 */
let runEffect: (() => void | (() => void)) | null = null;

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    runEffect = effect;
  },
}));

const show = vi.fn();

vi.mock("react-native-toast-message", () => ({ default: { show } }));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (
    select: (state: {
      isAuthenticated: boolean;
      user: { businessId: string; driverId: string };
    }) => unknown,
  ) =>
    select({
      isAuthenticated: true,
      user: { businessId: "business-1", driverId: "driver-1" },
    }),
}));

const invalidateQueries = vi.fn(async () => undefined);

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries },
}));

const handlers = new Map<string, (payload: unknown) => void>();

vi.mock("@/utils/socket", () => ({
  initializeSocket: async () => ({
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
  }),
  onRealtimeResync: () => () => undefined,
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  runEffect = null;
  handlers.clear();
  show.mockClear();
  invalidateQueries.mockClear();

  const { resetAnnouncedPlanChanges } = await import(
    "@/features/deliveries/plan-change-notice"
  );
  resetAnnouncedPlanChanges();
});

describe("plansAhead", () => {
  it("lists only the routes the cache already knew at an older version", async () => {
    const { plansAhead } = await import("@/features/deliveries/plan-change-rules");

    expect(
      plansAhead(
        [
          { id: "r1", code: 12, plan_version: 3 },
          { id: "r2", code: 13, plan_version: 1 },
        ],
        [
          { id: "r1", code: 12, plan_version: 4 },
          { id: "r2", code: 13, plan_version: 1 },
          // New to this phone: that is a release, told by its own toast.
          { id: "r3", code: 14, plan_version: 9 },
        ],
      ),
    ).toEqual([{ id: "r1", code: 12, plan_version: 4 }]);
  });

  it("says nothing when either side has no routes (a payload from before the field)", async () => {
    const { plansAhead } = await import("@/features/deliveries/plan-change-rules");

    expect(plansAhead(undefined, [{ id: "r1", code: 1, plan_version: 2 }])).toEqual([]);
    expect(plansAhead([{ id: "r1", code: 1, plan_version: 2 }], undefined)).toEqual([]);
  });

  it("ignores malformed rows instead of throwing", async () => {
    const { plansAhead } = await import("@/features/deliveries/plan-change-rules");

    expect(
      plansAhead(
        [{ id: "r1", code: 1, plan_version: 2 }],
        [{ id: "r1", code: 1, plan_version: "3" } as never],
      ),
    ).toEqual([]);
  });
});

describe("the dispatcher changing a released route, live", () => {
  it("shows 'A rota N foi alterada pelo despachante' and rereads the list", async () => {
    const { useRouteRealtime } = await import("@/features/deliveries/use-route-realtime");

    useRouteRealtime();
    runEffect?.();
    await flush();

    handlers.get("routeEvent")?.({
      type: "route.stops_changed",
      routeId: "r1",
      routeCode: 12,
      planVersion: 4,
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["my-deliveries", "business-1"],
    });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toMatchObject({
      text1: "Rota alterada",
      text2: "A rota 12 foi alterada pelo despachante.",
    });
  });

  it("is not repeated by the sync its own refetch triggers", async () => {
    const { useRouteRealtime } = await import("@/features/deliveries/use-route-realtime");
    const { announcePlanChangesBetween } = await import(
      "@/features/deliveries/plan-change-notice"
    );

    useRouteRealtime();
    runEffect?.();
    await flush();

    handlers.get("routeEvent")?.({
      type: "route.stops_changed",
      routeId: "r1",
      routeCode: 12,
      planVersion: 4,
    });

    announcePlanChangesBetween(
      [{ id: "r1", code: 12, plan_version: 3 }],
      [{ id: "r1", code: 12, plan_version: 4 }],
    );

    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe("the dispatcher changing a released route while the phone was offline", () => {
  it("shows the same notice once when the sync finds a newer plan", async () => {
    const { announcePlanChangesBetween } = await import(
      "@/features/deliveries/plan-change-notice"
    );

    const cached = [{ id: "r1", code: 12, plan_version: 3 }];
    const fresh = [{ id: "r1", code: 12, plan_version: 5 }];

    announcePlanChangesBetween(cached, fresh);
    announcePlanChangesBetween(cached, fresh);

    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0][0]).toMatchObject({
      text2: "A rota 12 foi alterada pelo despachante.",
    });
  });

  it("says nothing when the plan did not move", async () => {
    const { announcePlanChangesBetween } = await import(
      "@/features/deliveries/plan-change-notice"
    );

    announcePlanChangesBetween(
      [{ id: "r1", code: 12, plan_version: 3 }],
      [{ id: "r1", code: 12, plan_version: 3 }],
    );

    expect(show).not.toHaveBeenCalled();
  });
});
