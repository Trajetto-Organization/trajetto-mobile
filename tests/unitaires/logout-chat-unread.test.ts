import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signing out drops the unread-badge refetch still in its window (MOB-09,
 * decision 2.6).
 *
 * The badge refetch is coalesced: a burst of chat messages schedules ONE
 * `GET /chat/list-threads` 800 ms later. A driver who signs out inside that
 * window left it scheduled, and it fired against the cleared cache — on the
 * next person's session if they signed in fast enough.
 *
 * The real auth store and the real `unread-refresh`, over in-memory storage;
 * only the query client (to count the refetch), the socket and the server
 * logout are stubbed.
 */
const secure = new Map<string, string>();
const local = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secure.set(key, value),
  deleteItemAsync: async (key: string) => void secure.delete(key),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => local.get(key) ?? null,
    setItem: async (key: string, value: string) => void local.set(key, value),
    removeItem: async (key: string) => void local.delete(key),
    multiRemove: async (keys: string[]) => keys.forEach((key) => local.delete(key)),
    getAllKeys: async () => [...local.keys()],
  },
}));

vi.mock("@/utils/socket", () => ({
  disconnectSocket: () => undefined,
  setSocketTokenRefresher: () => undefined,
  updateSocketAuthToken: async () => undefined,
}));

vi.mock("@/utils/push-token", () => ({
  getRegisteredPushToken: () => null,
  setRegisteredPushToken: () => undefined,
}));

const invalidateQueries = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/providers/query-provider", () => ({
  clearQueryCache: async () => undefined,
  queryClient: { invalidateQueries },
}));

vi.mock("@/features/submissions/submission-id", () => ({
  clearAllSubmissionData: async () => undefined,
  disableSubmissionPersistence: () => undefined,
  enableSubmissionPersistence: () => undefined,
}));

vi.mock("@/features/auth/remote-logout", () => ({
  signOutRemotely: async () => undefined,
}));

const DRIVER = { id: "user-1", name: "Motorista", email: "m@example.com" };

let useAuthStore: typeof import("@/store/auth-store").useAuthStore;
let unread: typeof import("@/features/chat/unread-refresh");
let CHAT_COALESCE_MS: number;

const badgeRefetches = () =>
  invalidateQueries.mock.calls.filter(
    (call) =>
      JSON.stringify((call as unknown[])[0]) ===
      JSON.stringify({ queryKey: ["chat-unread"] }),
  ).length;

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );

  ({ useAuthStore } = await import("@/store/auth-store"));
  unread = await import("@/features/chat/unread-refresh");
  ({ CHAT_COALESCE_MS } = await import("@/features/chat/coalesce"));
});

beforeEach(() => {
  secure.clear();
  local.clear();
  invalidateQueries.mockClear();
  unread.cancelChatUnreadRefresh();

  secure.set(
    "session_v1",
    JSON.stringify({ version: 1, accessToken: "access", refreshToken: "refresh" }),
  );

  useAuthStore.setState({
    user: DRIVER as never,
    isAuthenticated: true,
    isInitialized: true,
  });

  // Only the coalescing window's timer is faked; storage and fetch resolve
  // as promises.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the unread badge refetch", () => {
  it("fires once per window while the session lasts (the harness sees it)", () => {
    unread.requestChatUnreadRefresh();
    unread.requestChatUnreadRefresh();

    vi.advanceTimersByTime(CHAT_COALESCE_MS);

    expect(badgeRefetches()).toBe(1);
  });

  it("is dropped by the logout when it is still waiting in its window", async () => {
    unread.requestChatUnreadRefresh();

    await useAuthStore.getState().logout();
    vi.advanceTimersByTime(CHAT_COALESCE_MS * 2);

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(badgeRefetches()).toBe(0);
  });

  it("owed behind a read cursor is dropped too, and the next session starts clean", async () => {
    // The open conversation holds the badge while its mark-read is on the
    // way; a message arriving meanwhile is owed to the release.
    const release = unread.holdChatUnreadRefresh();
    unread.requestChatUnreadRefresh();

    await useAuthStore.getState().logout();

    release();
    vi.advanceTimersByTime(CHAT_COALESCE_MS * 2);
    expect(badgeRefetches()).toBe(0);

    // Whoever signs in next gets their own refetches as usual.
    unread.requestChatUnreadRefresh();
    vi.advanceTimersByTime(CHAT_COALESCE_MS);
    expect(badgeRefetches()).toBe(1);
  });
});
