import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route's last points leave with the driver, not when they come back
 * (MOB-TRK-1).
 *
 * In foreground mode the GPS stops when the app leaves the screen. The
 * points already buffered sat on the phone until the driver returned, so the
 * tower showed the truck where it was a minute before the switch to Waze,
 * for as long as Waze stayed open. The tracking hook now flushes when the app
 * goes to the background.
 *
 * The hook runs for real outside React — effects run as they are declared —
 * with the OS, the storage-backed reporter and the task registry replaced.
 */

const harness = vi.hoisted(() => ({
  appStateListeners: [] as Array<(state: string) => void>,
  flushes: 0,
}));

vi.mock("react", () => {
  const api = {
    useEffect: (effect: () => void | (() => void)) => {
      effect();
    },
    useRef: <T,>(value: T) => ({ current: value }),
    useCallback: <T,>(fn: T) => fn,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
      getSnapshot(),
    useDebugValue: () => undefined,
  };

  return { ...api, default: api };
});

vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      harness.appStateListeners.push(listener);
      return {
        remove: () => {
          harness.appStateListeners = harness.appStateListeners.filter(
            (entry) => entry !== listener,
          );
        },
      };
    },
  },
  Linking: { openSettings: async () => undefined },
}));

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("expo-task-manager", () => ({ defineTask: () => undefined }));

vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: async () => ({
    status: "granted",
    granted: true,
    canAskAgain: true,
  }),
  getForegroundPermissionsAsync: async () => ({ status: "granted", granted: true }),
  hasStartedLocationUpdatesAsync: async () => false,
  stopLocationUpdatesAsync: async () => undefined,
  watchPositionAsync: async () => ({ remove: () => undefined }),
  PermissionStatus: { GRANTED: "granted" },
  Accuracy: { Balanced: 3 },
}));

vi.mock("@/features/tracking/reporter", () => ({
  flush: async () => {
    harness.flushes += 1;
    return { sent: 0, stopped: false };
  },
  ingest: async () => ({ kept: 0, halt: false }),
  isStopped: async () => false,
  resume: async () => undefined,
}));

vi.mock("@/features/tracking/tracking-status", async () => {
  const { createStore } = await import("zustand/vanilla");

  const store = createStore<{
    wanted: boolean;
    access: string;
    retryToken: number;
    report: (status: object) => void;
    retry: () => void;
    reset: () => void;
  }>((set) => ({
    wanted: false,
    access: "unknown",
    retryToken: 0,
    report: (status) => set(status),
    retry: () => set((state) => ({ retryToken: state.retryToken + 1 })),
    reset: () => set({ wanted: false, access: "unknown" }),
  }));

  const useTrackingStatus = Object.assign(
    (selector: (state: ReturnType<typeof store.getState>) => unknown) =>
      selector(store.getState()),
    store,
  );

  return { useTrackingStatus };
});

vi.mock("@/utils/storage", () => ({
  asyncStorage: { getItem: async () => null, setItem: async () => undefined },
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: () => undefined, warn: () => undefined },
}));

const { usePositionTracking } = await import(
  "@/features/tracking/use-position-tracking"
);

const ROUTE_RUNNING = [{ stops: [{ route: { status: "IN_PROGRESS" } }] }];
const NO_ROUTE = [{ stops: [{ route: { status: "RELEASED" } }] }];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function appGoes(state: string): void {
  for (const listener of [...harness.appStateListeners]) listener(state);
}

beforeEach(() => {
  harness.appStateListeners = [];
  harness.flushes = 0;
});

describe("a route in progress when the app leaves the screen", () => {
  it("sends the buffered points as the app goes to the background", async () => {
    usePositionTracking(ROUTE_RUNNING);
    await settle();

    harness.flushes = 0;

    appGoes("background");
    await settle();

    expect(harness.flushes).toBe(1);
  });

  it("does not flush on the brief 'inactive' of a notification shade", async () => {
    usePositionTracking(ROUTE_RUNNING);
    await settle();

    harness.flushes = 0;

    appGoes("inactive");
    appGoes("active");
    await settle();

    expect(harness.flushes).toBe(0);
  });

  it("has nothing to flush on leaving without a route running", async () => {
    usePositionTracking(NO_ROUTE);
    await settle();

    harness.flushes = 0;

    appGoes("background");
    await settle();

    expect(harness.flushes).toBe(0);
  });
});
