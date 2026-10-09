import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A route running without location is said out loud (MOB-TRK-5).
 *
 * A refused permission was a `logger.info` and nothing else: the driver ran
 * the route believing the central could see them, and the tower had no dot.
 * The tracking hook now reports what it found, and the deliveries screens
 * read it as a warning with the one gesture that fixes it.
 *
 * The hook runs for real outside React — effects run as they are declared —
 * with the OS permission, the storage-backed reporter and the task registry
 * replaced.
 */

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

const openSettings = vi.fn(async () => undefined);

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Linking: { openSettings: () => openSettings() },
}));

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("expo-task-manager", () => ({ defineTask: () => undefined }));

const permission = { granted: false, canAskAgain: true };

vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: async () => ({
    status: permission.granted ? "granted" : "denied",
    ...permission,
  }),
  getForegroundPermissionsAsync: async () => ({
    status: permission.granted ? "granted" : "denied",
    ...permission,
  }),
  hasStartedLocationUpdatesAsync: async () => false,
  stopLocationUpdatesAsync: async () => undefined,
  watchPositionAsync: async () => ({ remove: () => undefined }),
  PermissionStatus: { GRANTED: "granted" },
  Accuracy: { Balanced: 3 },
}));

vi.mock("@/features/tracking/reporter", () => ({
  flush: async () => ({ sent: 0, stopped: false }),
  ingest: async () => ({ kept: 0, halt: false }),
  isStopped: async () => false,
  resume: async () => undefined,
}));

// zustand's React binding lives in node_modules, where the React stub above
// does not reach; the store itself is the same, read without React.
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
const { useTrackingStatus } = await import("@/features/tracking/tracking-status");
const { useLocationWarning } = await import(
  "@/features/tracking/use-location-warning"
);
const { locationAccessOf, locationWarning } = await import(
  "@/features/tracking/location-access-rules"
);

const ROUTE_RUNNING = [{ stops: [{ route: { status: "IN_PROGRESS" } }] }];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  permission.granted = false;
  permission.canAskAgain = true;
  openSettings.mockClear();
  useTrackingStatus.setState({ wanted: false, access: "unknown", retryToken: 0 });
});

describe("the warning rule", () => {
  it("speaks only while a route runs without location", () => {
    expect(locationWarning({ wanted: false, access: "denied" })).toBeNull();
    expect(locationWarning({ wanted: true, access: "granted" })).toBeNull();
    expect(locationWarning({ wanted: true, access: "unknown" })).toBeNull();

    expect(locationWarning({ wanted: true, access: "denied" })).toMatchObject({
      action: "request",
      actionLabel: "Permitir localização",
    });
    expect(locationWarning({ wanted: true, access: "blocked" })).toMatchObject({
      action: "settings",
      actionLabel: "Abrir configurações",
    });
  });

  it("tells a refusal Android will ask again from one it will not", () => {
    expect(locationAccessOf({ granted: true })).toBe("granted");
    expect(locationAccessOf({ granted: false, canAskAgain: true })).toBe("denied");
    expect(locationAccessOf({ granted: false, canAskAgain: false })).toBe("blocked");
  });
});

describe("a route in progress with the permission refused", () => {
  it("is reported by the tracking hook, and the screen warns", async () => {
    usePositionTracking(ROUTE_RUNNING);
    await settle();

    const status = useTrackingStatus.getState();

    expect(status.wanted).toBe(true);
    expect(status.access).toBe("denied");
    expect(useLocationWarning().warning?.title).toBe("Localização desativada");
  });

  it("allowing it from the warning restarts the tracking", async () => {
    usePositionTracking(ROUTE_RUNNING);
    await settle();

    permission.granted = true;
    await useLocationWarning().resolve();

    const status = useTrackingStatus.getState();

    expect(status.access).toBe("granted");
    expect(status.retryToken).toBe(1);
    expect(useLocationWarning().warning).toBeNull();
  });

  it("refused for good, the warning sends the driver to the settings", async () => {
    permission.canAskAgain = false;

    usePositionTracking(ROUTE_RUNNING);
    await settle();

    const { warning, resolve } = useLocationWarning();

    expect(warning?.action).toBe("settings");

    await resolve();

    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("says nothing without a route running", async () => {
    usePositionTracking([{ stops: [{ route: { status: "RELEASED" } }] }]);
    await settle();

    expect(useLocationWarning().warning).toBeNull();
  });
});
