import { createRequire } from "node:module";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The hook `require`s the chime (an .aac asset, which Metro resolves to an
// id). Node would parse it as JavaScript; here it resolves to an id too.
const nodeRequire = createRequire(import.meta.url);
nodeRequire.extensions[".aac"] = (module) => {
  module.exports = 1;
};

/**
 * The in-app chime rings only with the app on screen (MOB-20).
 *
 * The socket now stays connected for a short while after the driver switches
 * to another app, so a notification can reach it in the background. The
 * system push rings for that one already; the in-app chime on top of it
 * would be a second sound, over the driver's navigation.
 *
 * The real hook, run outside a renderer: `useEffect` is captured and run by
 * hand, the socket is a set of handlers, and the audio player is a spy.
 */
let runEffect: (() => void | (() => void)) | null = null;

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    runEffect = effect;
  },
}));

const appState = vi.hoisted(() => ({ currentState: "active" }));
vi.mock("react-native", () => ({ AppState: appState }));

vi.mock("expo-router", () => ({ useRouter: () => ({ navigate: () => {} }) }));

const play = vi.hoisted(() => vi.fn());
vi.mock("expo-audio", () => ({
  createAudioPlayer: () => ({ seekTo: () => undefined, play }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("react-native-toast-message", () => ({ default: { show: toast } }));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (select: (state: { isAuthenticated: boolean }) => unknown) =>
    select({ isAuthenticated: true }),
}));

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries: async () => undefined },
}));

const applied = vi.hoisted(() => vi.fn());
vi.mock("@/features/notifications/use-notifications", () => ({
  applyIncomingNotification: applied,
  applyNotificationsRead: () => undefined,
  refreshUnreadCount: () => undefined,
}));

const handlers = new Map<string, (payload?: unknown) => void>();

vi.mock("@/utils/socket", () => ({
  initializeSocket: async () => ({
    on: (event: string, handler: (payload?: unknown) => void) =>
      handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
  }),
  onRealtimeResync: () => () => undefined,
}));

let useNotificationsRealtime: typeof import("@/features/notifications/use-notifications-realtime").useNotificationsRealtime;

beforeAll(async () => {
  ({ useNotificationsRealtime } = await import(
    "@/features/notifications/use-notifications-realtime"
  ));
});

beforeEach(async () => {
  handlers.clear();
  play.mockClear();
  toast.mockClear();
  applied.mockClear();

  useNotificationsRealtime();
  runEffect?.();

  // initializeSocket resolves, and the handlers are bound.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(handlers.has("pushNotification")).toBe(true);
});

const arrival = (id: string) => ({ id, title: "Rota liberada", message: "Rota 7" });

describe("a notification arriving over the socket", () => {
  it("rings in the foreground", () => {
    appState.currentState = "active";

    handlers.get("pushNotification")?.(arrival("n1"));

    expect(applied).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("updates the badge but does not ring in the background", () => {
    appState.currentState = "background";

    handlers.get("pushNotification")?.(arrival("n2"));

    expect(applied).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();

    appState.currentState = "active";
  });
});
