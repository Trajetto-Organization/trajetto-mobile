import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { QueryObserver, focusManager } from "@tanstack/react-query";

/**
 * What a return to the app costs the network (MOB-20).
 *
 * A driver alternates with Waze dozens of times a day. Every return used to
 * be a `/user/me`, a socket handshake (three queries on the API), and the
 * realtime lists fetched twice — by React Query's focus refetch, then by the
 * reconnection's resync a second later — for a ten-second glance at a map.
 *
 * Counted here with the real pieces: the real socket module (over a stubbed
 * socket.io-client that counts handshakes), the app's real QueryClient with
 * its real focus rule, and resync listeners that invalidate the same keys
 * the realtime hooks do (pinned in route-realtime-resync and
 * realtime-reconnect-backoff). What each provider does on an AppState change
 * is replayed by `leaveApp`/`returnToApp` and pinned by the wiring checks at
 * the end.
 */

// ------------------------------------------------------------ the network
const net = vi.hoisted(() => ({
  handshakes: 0,
  reachable: true,
  pending: [] as Array<() => void>,
}));

vi.mock("socket.io-client", () => ({
  io: () => {
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();

    const fire = (event: string, ...args: unknown[]) =>
      [...(handlers.get(event) ?? [])].forEach((handler) => handler(...args));

    const socket = {
      connected: false,
      active: false,
      on(event: string, handler: (...args: unknown[]) => void) {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
        return socket;
      },
      off(event: string, handler?: (...args: unknown[]) => void) {
        if (handler) handlers.get(event)?.delete(handler);
        else handlers.delete(event);
        return socket;
      },
      emit: () => socket,
      connect() {
        net.handshakes += 1;
        socket.active = true;

        const accept = () => {
          socket.connected = true;
          fire("connect");
        };

        if (net.reachable) queueMicrotask(accept);
        else net.pending.push(accept);

        return socket;
      },
      disconnect() {
        const wasConnected = socket.connected;

        socket.connected = false;
        socket.active = false;

        if (wasConnected) fire("disconnect", "io client disconnect");
        return socket;
      },
    };

    return socket;
  },
}));

vi.mock("@/utils/storage", () => ({
  tokenStorage: { getAccessToken: async () => "token" },
}));

// The QueryClient's module: only its platform bindings are stubbed.
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Platform: { OS: "android" },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => undefined },
}));

type SocketModule = typeof import("@/utils/socket");
type Rules = typeof import("@/features/foreground/return-rules");

let socket: SocketModule;
let rules: Rules;
let queryClient: typeof import("@/providers/query-provider").queryClient;

// ------------------------------------------------------------- the lists
const BUSINESS = "business-1";

const gets = { deliveries: 0, notifications: 0, chatUnread: 0, userMe: 0 };

const observers: Array<() => void> = [];

function watch(queryKey: readonly unknown[], counter: keyof typeof gets): void {
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => {
      gets[counter] += 1;
      return { at: Date.now() };
    },
  });

  observers.push(observer.subscribe(() => undefined));
}

/** What each provider does when the app leaves (in subscription order). */
function leaveApp(): void {
  socket.backgroundSocket(); // SocketProvider
  focusManager.setFocused(false); // QueryProvider
}

/** What each provider does when it comes back (in subscription order). */
async function returnToApp(): Promise<void> {
  const reconnection = socket.foregroundSocket().catch(() => undefined); // SocketProvider

  if (!socket.socketCarriedLastAbsence()) gets.userMe += 1; // AuthProvider

  focusManager.setFocused(true); // QueryProvider

  await reconnection;
  await vi.advanceTimersByTimeAsync(0);
}

async function awayFor(ms: number): Promise<void> {
  leaveApp();
  await vi.advanceTimersByTimeAsync(ms);
  await returnToApp();

  // The resync's jitter (Math.random is pinned to 0) and any fetch it starts.
  await vi.advanceTimersByTimeAsync(1);
}

const requests = () =>
  net.handshakes + gets.userMe + gets.deliveries + gets.notifications + gets.chatUnread;

function resetCounts(): void {
  net.handshakes = 0;
  gets.deliveries = 0;
  gets.notifications = 0;
  gets.chatUnread = 0;
  gets.userMe = 0;
}

beforeAll(async () => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  socket = await import("@/utils/socket");
  rules = await import("@/features/foreground/return-rules");
  ({ queryClient } = await import("@/providers/query-provider"));

  // What QueryClientProvider does on mount: subscribes to focus and online.
  queryClient.mount();
});

afterAll(() => {
  queryClient.unmount();
});

let stopResync: Array<() => void> = [];

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
  vi.spyOn(Math, "random").mockReturnValue(0);

  net.reachable = true;
  net.pending = [];

  queryClient.clear();
  focusManager.setFocused(true);

  // The realtime hooks' resync listeners, on the keys they use.
  stopResync = [
    socket.onRealtimeResync(
      () => void queryClient.invalidateQueries({ queryKey: ["my-deliveries", BUSINESS] }),
    ),
    socket.onRealtimeResync(
      () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    ),
  ];

  // Signed in, socket up, the three lists of the deliveries tab on screen.
  await socket.reconnectSocket();
  await vi.advanceTimersByTimeAsync(0);

  watch(["my-deliveries", BUSINESS], "deliveries");
  watch(["notifications", "unread-count"], "notifications");
  watch(["chat-unread"], "chatUnread");
  await vi.advanceTimersByTimeAsync(0);

  resetCounts();
});

afterEach(() => {
  observers.splice(0).forEach((unsubscribe) => unsubscribe());
  stopResync.forEach((stop) => stop());

  socket.disconnectSocket(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const SIX_MINUTES = 6 * 60 * 1000;

describe("a glance at Waze and back (10 s)", () => {
  it("costs nothing while the lists are fresh", async () => {
    await awayFor(10_000);

    expect(net.handshakes, "handshake").toBe(0);
    expect(gets.userMe, "/user/me").toBe(0);
    expect(requests()).toBe(0);
  });

  it("costs only the ordinary refetch of lists past their stale time", async () => {
    await vi.advanceTimersByTimeAsync(SIX_MINUTES);

    await awayFor(10_000);

    // No handshake, no /user/me, no resync: one GET per stale list.
    expect({ ...gets, handshakes: net.handshakes }).toEqual({
      deliveries: 1,
      notifications: 1,
      chatUnread: 1,
      userMe: 0,
      handshakes: 0,
    });
  });

  it("over a morning of them, never reconnects nor re-reads the session", async () => {
    const trips = 30;
    const tripMs = 10_000 + 60_000;

    for (let trip = 0; trip < trips; trip += 1) {
      await awayFor(10_000);
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(net.handshakes).toBe(0);
    expect(gets.userMe).toBe(0);

    // The lists refresh on their own clock (5 min stale time), not per trip:
    // before, each trip also cost a resync of both realtime lists.
    const staleWindows = Math.ceil((trips * tripMs) / (5 * 60 * 1000));

    expect(gets.deliveries).toBeLessThanOrEqual(staleWindows);
    expect(gets.notifications).toBeLessThanOrEqual(staleWindows);
  });
});

describe("a long absence (10 min on the road)", () => {
  it("reconnects once and fetches each realtime list once, after the socket is back", async () => {
    await awayFor(10 * 60 * 1000);

    expect({ ...gets, handshakes: net.handshakes }).toEqual({
      // The resync, not the focus refetch: sent once the room is rejoined.
      deliveries: 1,
      notifications: 1,
      // Not a realtime list: its focus refetch is the catch-up.
      chatUnread: 1,
      userMe: 1,
      handshakes: 1,
    });
  });

  it("still catches the lists up over HTTP when the socket does not come back", async () => {
    net.reachable = false;

    await awayFor(10 * 60 * 1000);

    expect(gets.deliveries, "waiting for the resync").toBe(0);

    await vi.advanceTimersByTimeAsync(rules.RETURN_RESYNC_FALLBACK_MS);

    expect(gets.deliveries).toBe(1);
    expect(gets.notifications).toBe(1);
    expect(socket.socketResyncOwed()).toBe(false);

    // The socket making it later is a reconnection like any other.
    net.pending.splice(0).forEach((accept) => accept());
    await vi.advanceTimersByTimeAsync(1);

    expect(gets.deliveries).toBe(2);
  });
});

describe("the socket in the background", () => {
  it("is paused once the grace runs out, not at once", async () => {
    leaveApp();

    await vi.advanceTimersByTimeAsync(rules.SOCKET_BACKGROUND_GRACE_MS - 1);
    expect(socket.isSocketConnected()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(socket.isSocketConnected()).toBe(false);
    expect(socket.socketResyncOwed()).toBe(true);
  });

  it("did not carry an absence it dropped in the middle of", async () => {
    leaveApp();
    await vi.advanceTimersByTimeAsync(5_000);

    // A network change in the background: the manager reconnects.
    socket.getSocket()?.disconnect();
    await socket.reconnectSocket();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(5_000);
    await returnToApp();

    expect(gets.userMe, "the gap may have hidden a security event").toBe(1);
  });

  it("forgets everything on logout", async () => {
    leaveApp();
    socket.disconnectSocket(false);

    await vi.advanceTimersByTimeAsync(rules.SOCKET_BACKGROUND_GRACE_MS);

    expect(socket.socketCarriedLastAbsence()).toBe(false);
    expect(socket.socketResyncOwed()).toBe(false);
  });
});

describe("the rules", () => {
  const { socketCarriedAbsence, refetchOnFocus } = {
    socketCarriedAbsence: (...args: Parameters<Rules["socketCarriedAbsence"]>) =>
      rules.socketCarriedAbsence(...args),
    refetchOnFocus: (...args: Parameters<Rules["refetchOnFocus"]>) =>
      rules.refetchOnFocus(...args),
  };

  it("trust the socket only if it was up before the app left and the return is quick", () => {
    const grace = rules.SOCKET_BACKGROUND_GRACE_MS;

    expect(socketCarriedAbsence({ leftAt: 1_000, liveSince: 500, now: 1_000 + grace - 1 })).toBe(true);
    expect(socketCarriedAbsence({ leftAt: 1_000, liveSince: 500, now: 1_000 + grace })).toBe(false);
    expect(socketCarriedAbsence({ leftAt: 1_000, liveSince: 1_500, now: 2_000 })).toBe(false);
    expect(socketCarriedAbsence({ leftAt: 1_000, liveSince: null, now: 2_000 })).toBe(false);
    expect(socketCarriedAbsence({ leftAt: null, liveSince: 500, now: 2_000 })).toBe(false);
  });

  it("keep the grace under the server's ping timeout (20 s)", () => {
    expect(rules.SOCKET_BACKGROUND_GRACE_MS).toBeLessThanOrEqual(20_000);
  });

  it("hold back only the realtime lists, and only while a resync is owed", () => {
    expect(refetchOnFocus(["my-deliveries", BUSINESS], true)).toBe(false);
    expect(refetchOnFocus(["notifications", "list"], true)).toBe(false);
    expect(refetchOnFocus(["chat-unread"], true)).toBe(true);
    expect(refetchOnFocus(["vehicles", BUSINESS], true)).toBe(true);
    expect(refetchOnFocus(["my-deliveries", BUSINESS], false)).toBe(true);
  });
});

describe("the providers' wiring", () => {
  const read = (path: string) =>
    readFileSync(resolve(__dirname, "../..", path), "utf8").replace(/\r\n/g, "\n");

  it("the socket provider defers the pause and resumes through the socket module", () => {
    const source = read("providers/socket-provider.tsx");

    expect(source).toMatch(/if \(nextState !== "active"\) \{\s*backgroundSocket\(\);/);
    expect(source).toMatch(/void foregroundSocket\(\)/);
    expect(source).not.toMatch(/pauseSocket\(\)/);
  });

  it("the auth provider skips /user/me only when the socket carried the absence", () => {
    const source = read("providers/auth-provider.tsx");
    const skip = source.indexOf("if (socketCarriedLastAbsence()) return;");

    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(source.indexOf("checkAuth({ background: true })"));
  });

  it("the chat skips its foreground reconciliation on the same condition", () => {
    const source = read("features/chat/use-chat-realtime.ts");
    const appState = source.slice(source.indexOf('AppState.addEventListener("change"'));

    expect(appState.indexOf("if (socketCarriedLastAbsence()) return;")).toBeGreaterThan(-1);
    expect(appState.indexOf("if (socketCarriedLastAbsence()) return;")).toBeLessThan(
      appState.indexOf("void reconcileDelivery();"),
    );
  });

  it("the query client asks the focus rule, with the socket's resync state", () => {
    const options = queryClient.getDefaultOptions().queries;

    expect(typeof options?.refetchOnWindowFocus).toBe("function");
    expect(read("providers/query-provider.tsx")).toMatch(
      /refetchOnFocus\(query\.queryKey, socketResyncOwed\(\)\)/,
    );
  });
});
