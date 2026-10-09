import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The driver's list after the socket came back (SOCKET-13).
 *
 * `routeEvent` and `deliveryEvent` both invalidate `["my-deliveries",
 * businessId]`, and the API has no replay: a route released or a stop
 * reassigned while the socket was down never arrives. The socket module
 * announces the reconnection (socket-resync.test.ts); this pins that the list
 * listens, under the same key the events use, and stops listening on logout.
 *
 * The hook runs outside a renderer: `useEffect` is captured and run by hand.
 */
let runEffect: (() => void | (() => void)) | null = null;

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    runEffect = effect;
  },
}));

vi.mock("react-native-toast-message", () => ({ default: { show: () => {} } }));

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

const resyncListeners = new Set<() => void>();

vi.mock("@/utils/socket", () => ({
  initializeSocket: async () => ({ on: () => undefined, off: () => undefined }),
  onRealtimeResync: (listener: () => void) => {
    resyncListeners.add(listener);
    return () => {
      resyncListeners.delete(listener);
    };
  },
}));

describe("the driver's list after a reconnection", () => {
  beforeEach(() => {
    runEffect = null;
    resyncListeners.clear();
    invalidateQueries.mockClear();
  });

  it("is refetched under the key the route and delivery events use", async () => {
    const { useRouteRealtime } = await import("@/features/deliveries/use-route-realtime");

    useRouteRealtime();
    const cleanup = runEffect?.();

    expect(resyncListeners.size, "a lista não escuta a reconexão").toBe(1);

    [...resyncListeners].forEach((listener) => listener());

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["my-deliveries", "business-1"],
    });

    // Logout: a later reconnection must not reach this listener.
    if (typeof cleanup === "function") cleanup();
    expect(resyncListeners.size).toBe(0);
  });
});
