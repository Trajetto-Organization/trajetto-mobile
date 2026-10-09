import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The unread badge during a burst of arrivals (MOB-09).
 *
 * `useChatRealtime` runs across the whole protected area. It used to
 * invalidate `["chat-unread"]` once per arriving message, so a broadcast of
 * twenty messages was twenty `GET /chat/list-threads`. The hook runs outside
 * a renderer: its effects are captured and run by hand.
 */
const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);

vi.mock("react", () => ({
  useCallback: <T,>(callback: T) => callback,
  useRef: <T,>(initial: T) => ({ current: initial }),
  useEffect: (effect: () => void | (() => void)) => {
    effects.push(effect);
  },
}));

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
}));

vi.mock("expo-router", () => ({
  usePathname: () => "/deliveries",
  useRouter: () => ({ navigate: () => undefined }),
}));

vi.mock("react-native-toast-message", () => ({ default: { show: () => undefined } }));

// A driver whose company has Entregas on: the one user the chat exists for.
vi.mock("@/store/auth-store", () => {
  const state = {
    isAuthenticated: true,
    user: {
      id: "user-driver",
      role: "BUSINESS_USER",
      businessId: "business-1",
      driverId: "driver-1",
      enabledModules: ["DELIVERIES", "FLEET"],
    },
  };

  return {
    useAuthStore: Object.assign(
      (select: (value: typeof state) => unknown) => select(state),
      { getState: () => state },
    ),
  };
});

const invalidateQueries = vi.hoisted(() =>
  vi.fn(async (_filter: { queryKey: unknown }) => undefined),
);

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries },
}));

vi.mock("@/utils/api", () => ({
  apiClient: {
    get: async () => ({ threadId: null, data: [] }),
    post: async () => ({}),
  },
}));

const handlers = vi.hoisted(() => new Map<string, (payload?: unknown) => void>());

vi.mock("@/utils/socket", () => ({
  initializeSocket: async () => ({
    connected: false,
    on: (event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler);
    },
    off: () => undefined,
  }),
}));

beforeEach(async () => {
  vi.useFakeTimers();
  effects.length = 0;
  handlers.clear();
  invalidateQueries.mockClear();

  // A window left open by another test must not swallow this one's refresh.
  const unread = (await import("@/features/chat/unread-refresh").catch(
    () => null,
  )) as { cancelChatUnreadRefresh?: () => void } | null;

  unread?.cancelChatUnreadRefresh?.();
});

afterEach(() => {
  vi.useRealTimers();
});

const badgeRefetches = () =>
  invalidateQueries.mock.calls.filter(
    ([filter]) => JSON.stringify(filter.queryKey) === JSON.stringify(["chat-unread"]),
  ).length;

describe("the unread badge while a broadcast lands", () => {
  it("is refetched once for the whole burst, not once per message", async () => {
    const { useChatRealtime } = await import("@/features/chat/use-chat-realtime");

    useChatRealtime();
    effects.forEach((effect) => effect());
    await vi.advanceTimersByTimeAsync(0);

    const onMessage = handlers.get("chatMessage");

    expect(onMessage, "o hook não escuta chatMessage").toBeDefined();

    for (let index = 0; index < 20; index += 1) {
      onMessage!({
        id: `b${index}`,
        threadId: "thread-1",
        senderId: "user-agent",
        sender: { id: "user-agent", name: "Central" },
        kind: "TEXT",
        body: "Aviso",
        broadcast_id: "broadcast-1",
        created_at: new Date(Date.UTC(2026, 8, 28, 12, index)).toISOString(),
      });
    }

    await vi.advanceTimersByTimeAsync(1_000);

    expect(badgeRefetches()).toBe(1);
  });
});

describe("the badge while the open conversation posts its read cursor", () => {
  it("waits for the cursor: requests made meanwhile become one refetch after the release", async () => {
    const unread = await import("@/features/chat/unread-refresh");

    const release = unread.holdChatUnreadRefresh();

    // An arrival anywhere in the app, and the mark-read's own request.
    unread.requestChatUnreadRefresh();
    unread.requestChatUnreadRefresh();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(badgeRefetches()).toBe(0);

    release();
    release(); // A second call is a no-op.

    await vi.advanceTimersByTimeAsync(800);
    expect(badgeRefetches()).toBe(1);
  });

  it("takes back a refetch already scheduled when the hold starts, instead of reading the old cursor", async () => {
    const unread = await import("@/features/chat/unread-refresh");

    unread.requestChatUnreadRefresh();

    const release = unread.holdChatUnreadRefresh();

    await vi.advanceTimersByTimeAsync(800);
    expect(badgeRefetches()).toBe(0);

    release();
    await vi.advanceTimersByTimeAsync(800);
    expect(badgeRefetches()).toBe(1);
  });

  it("refetches nothing on release when nobody asked", async () => {
    const unread = await import("@/features/chat/unread-refresh");

    unread.holdChatUnreadRefresh()();

    await vi.advanceTimersByTimeAsync(800);
    expect(badgeRefetches()).toBe(0);
  });
});

describe("a message about a delivery arriving anywhere in the app", () => {
  it("marks that delivery's own preview stale, and no other", async () => {
    const { useChatRealtime } = await import("@/features/chat/use-chat-realtime");

    useChatRealtime();
    effects.forEach((effect) => effect());
    await vi.advanceTimersByTimeAsync(0);

    const onMessage = handlers.get("chatMessage")!;
    const base = {
      threadId: "thread-1",
      senderId: "user-agent",
      sender: { id: "user-agent", name: "Central" },
      kind: "TEXT",
      body: "Deixe na portaria",
      broadcast_id: null,
      created_at: new Date(Date.UTC(2026, 8, 29, 12, 0)).toISOString(),
    };

    onMessage({ ...base, id: "about-delivery", deliveryId: "delivery-1" });
    onMessage({ ...base, id: "about-nothing", deliveryId: null });

    const linked = invalidateQueries.mock.calls
      .map(([filter]) => filter.queryKey)
      .filter((key) => Array.isArray(key) && key[0] === "chat-linked");

    expect(linked).toEqual([["chat-linked", "delivery", "delivery-1"]]);
  });
});
