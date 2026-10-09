import { beforeEach, describe, expect, it, vi } from "vitest";

import { createResponseGate } from "@/features/notifications/notification-rules";

/**
 * An old tray tap does not navigate again after the next login (MOB-23).
 *
 * The protected layout (and this hook with it) is remounted on every login.
 * The "already handled" record lived in a ref of that layout, and
 * `getLastNotificationResponse` keeps returning the last tap until someone
 * clears it — so after signing out and back in, the app jumped to /chat or
 * /notifications on its own, on a shared phone even for the next driver.
 *
 * Runs the real hook, effects captured by hand (as in
 * route-realtime-resync.test.ts), with expo-notifications faked.
 */
let effects: Array<() => void | (() => void)> = [];

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    effects.push(effect);
  },
}));

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: "android" },
}));

vi.mock("expo-constants", () => ({
  default: { executionEnvironment: "standalone", expoConfig: {} },
  ExecutionEnvironment: { StoreClient: "storeClient" },
}));

vi.mock("expo-device", () => ({ isDevice: false }));

const navigate = vi.fn();

vi.mock("expo-router", () => ({ useRouter: () => ({ navigate }) }));

const tap: {
  notification: {
    request: { identifier: string; content: { data: { url?: string } } };
  };
} = {
  notification: {
    request: {
      identifier: "push-1",
      content: { data: { url: "/chat" } },
    },
  },
};

let lastResponse: typeof tap | null = null;
let responseListener: ((response: typeof tap) => void) | null = null;

const clearLastNotificationResponse = vi.fn(() => {
  lastResponse = null;
});

vi.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: (
    listener: (response: typeof tap) => void,
  ) => {
    responseListener = listener;
    return { remove: () => undefined };
  },
  getLastNotificationResponseAsync: async () => lastResponse,
  clearLastNotificationResponse: () => clearLastNotificationResponse(),
}));

let sessionUser: { driverId?: string; enabledModules?: string[] } | null = {
  driverId: "d1",
  enabledModules: ["DELIVERIES"],
};

vi.mock("@/store/auth-store", () => ({
  useAuthStore: { getState: () => ({ user: sessionUser }) },
}));

vi.mock("@/utils/api", () => ({ apiClient: { request: async () => ({}) } }));
vi.mock("@/utils/logger", () => ({ logger: { dev: () => undefined } }));
vi.mock("@/utils/push-token", () => ({ setRegisteredPushToken: () => undefined }));
vi.mock("@/store/connection-store", () => ({
  useConnectionStore: { subscribe: () => () => undefined },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Mounts the hook as the protected layout does after a login. */
async function mountAfterLogin(): Promise<void> {
  const { usePushNotifications } = await import(
    "@/features/notifications/use-push-notifications"
  );

  effects = [];
  responseListener = null;

  usePushNotifications();
  effects.forEach((effect) => effect());

  // The hook loads expo-notifications with a dynamic import, which a busy
  // runner (the whole suite in parallel) resolves later than two timer
  // ticks: wait for the listener it registers, then for the cold-start read.
  for (let tick = 0; tick < 200 && !responseListener; tick += 1) await flush();

  await flush();
  await flush();
}

beforeEach(() => {
  navigate.mockReset();
  clearLastNotificationResponse.mockClear();
});

describe("a tray tap that opened the app", () => {
  it("navigates once, and not again after signing out and back in", async () => {
    lastResponse = tap;

    await mountAfterLogin();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/chat");

    // Handled, so it is no longer "the last tap" for the next login.
    expect(clearLastNotificationResponse).toHaveBeenCalledTimes(1);

    // Logout, then another login on the same process: a fresh mount.
    await mountAfterLogin();

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("is acted on once when the listener delivers it as well", async () => {
    // Both paths can report the same tap; the second must not stack screens.
    responseListener?.({
      notification: {
        request: { identifier: "push-2", content: { data: {} } },
      },
    });
    responseListener?.({
      notification: {
        request: { identifier: "push-2", content: { data: {} } },
      },
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/notifications");
  });

  it("opens the notifications list when the session has no chat", async () => {
    // Entregas switched off since the push was sent: there is no chat tab
    // to land on, and a tap that goes nowhere looks broken.
    sessionUser = { driverId: "d1", enabledModules: ["FLEET"] };

    responseListener?.({
      notification: {
        request: { identifier: "push-3", content: { data: { url: "/chat" } } },
      },
    });

    expect(navigate).toHaveBeenCalledWith("/notifications");

    sessionUser = { driverId: "d1", enabledModules: ["DELIVERIES"] };
  });

  it("opens the day's list for a push about the list or a route", async () => {
    // "Entrega retirada da sua lista" names /deliveries; "Sua rota foi
    // liberada" names /route, and a route is a section of that list.
    responseListener?.({
      notification: {
        request: { identifier: "push-4", content: { data: { url: "/deliveries" } } },
      },
    });
    responseListener?.({
      notification: {
        request: { identifier: "push-5", content: { data: { url: "/route" } } },
      },
    });

    expect(navigate.mock.calls).toEqual([["/deliveries"], ["/deliveries"]]);
  });
});

describe("the gate", () => {
  it("lets each tap through once and forgets the oldest past its size", () => {
    const gate = createResponseGate(2);

    expect(gate.claim("a")).toBe(true);
    expect(gate.claim("a")).toBe(false);
    expect(gate.claim("b")).toBe(true);
    expect(gate.claim("c")).toBe(true);

    // "a" fell out of the window; a two-week-old tap coming back is not a
    // real case, a process holding every id forever would be.
    expect(gate.claim("a")).toBe(true);
    expect(gate.claim("c")).toBe(false);
  });
});
