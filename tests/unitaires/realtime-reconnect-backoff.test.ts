import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fleet coming back after the API went away (MOB-12).
 *
 * Two halves:
 *
 * - how fast every phone reconnects. The manager's ceiling was ten seconds,
 *   so after both replicas went down the whole foreground fleet was back
 *   within ten seconds of each other, three queries per handshake;
 * - what a phone asks again once it is back. The API has no replay: a
 *   notification emitted while the socket was down never arrives, and the
 *   badge stayed wrong until the next focus change.
 */

// ------------------------------------------------------------- socket.io
const ioOptions: Array<Record<string, unknown>> = [];

vi.mock("socket.io-client", () => ({
  io: (_url: string, options: Record<string, unknown>) => {
    ioOptions.push(options);

    return {
      on: () => undefined,
      off: () => undefined,
      connect: () => undefined,
      disconnect: () => undefined,
      connected: false,
      active: false,
    };
  },
}));

vi.mock("@/utils/storage", () => ({
  tokenStorage: { getAccessToken: async () => "token" },
}));

describe("the socket's reconnection backoff", () => {
  it("backs off to at least thirty seconds, with jitter", async () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

    const { initializeSocket } = await import("@/utils/socket");
    await initializeSocket();

    const [options] = ioOptions;

    expect(options.reconnectionDelayMax).toBeGreaterThanOrEqual(30_000);
    expect(options.randomizationFactor).toBeGreaterThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------- notifications
let runEffect: (() => void | (() => void)) | null = null;

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    runEffect = effect;
  },
}));

vi.mock("expo-router", () => ({ useRouter: () => ({ navigate: () => {} }) }));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("expo-audio", () => ({ createAudioPlayer: () => ({}) }));
vi.mock("react-native-toast-message", () => ({ default: { show: () => {} } }));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (select: (state: { isAuthenticated: boolean }) => unknown) =>
    select({ isAuthenticated: true }),
}));

const invalidateQueries = vi.fn(async () => undefined);

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries },
}));

vi.mock("@/features/notifications/use-notifications", () => ({
  applyIncomingNotification: () => undefined,
}));

describe("the notifications after a reconnection", () => {
  beforeEach(() => {
    runEffect = null;
    invalidateQueries.mockClear();
  });

  it("ask the server again for the badge and the list", async () => {
    const socketModule = await import("@/utils/socket");
    const resync = vi.spyOn(socketModule, "onRealtimeResync");

    const { useNotificationsRealtime } = await import(
      "@/features/notifications/use-notifications-realtime"
    );

    useNotificationsRealtime();
    const cleanup = runEffect?.();

    expect(resync).toHaveBeenCalledTimes(1);

    const [listener] = resync.mock.calls[0];
    listener();

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["notifications"],
    });

    // Unmounted (logout): a later reconnection must not reach this listener.
    if (typeof cleanup === "function") cleanup();
    invalidateQueries.mockClear();
    listener();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
