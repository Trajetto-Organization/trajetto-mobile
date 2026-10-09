import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signing out sends the route's last stretch first (MOB-24).
 *
 * The flush on the way out ran from the protected layout's cleanup, after the
 * logout had already cleared the session: it found nobody signed in and sent
 * nothing, and the next driver on the phone discarded the buffer. The logout
 * now sends it while the session exists — before the server logout ends it —
 * with the token it is about to throw away.
 *
 * The real auth store and the real position reporter, over in-memory storage
 * and a stubbed `fetch`; the push/server logout is recorded, not sent.
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

vi.mock("@/providers/query-provider", () => ({
  clearQueryCache: async () => undefined,
}));

vi.mock("@/features/submissions/submission-id", () => ({
  clearAllSubmissionData: async () => undefined,
  disableSubmissionPersistence: () => undefined,
  enableSubmissionPersistence: () => undefined,
}));

/** What left the phone, in order. */
const sent: string[] = [];
const positionRequests: Array<{ authorization: string | null; pings: number }> = [];

vi.mock("@/features/auth/remote-logout", () => ({
  signOutRemotely: async () => {
    sent.push("server-logout");
  },
}));

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const now = Math.floor(Date.now() / 1000);

const ACCESS_TOKEN = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "user-1", iat: now, exp: now + 900 })}.signature`;

const DRIVER = { id: "user-1", name: "Motorista", email: "m@example.com" };

let useAuthStore: typeof import("@/store/auth-store").useAuthStore;

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith("/route/positions")) {
        const headers = init.headers as Record<string, string>;
        const body = JSON.parse(String(init.body)) as { pings: unknown[] };

        sent.push("positions");
        positionRequests.push({
          authorization: headers.Authorization ?? null,
          pings: body.pings.length,
        });

        return new Response(
          JSON.stringify({
            data: { stored: body.pings.length, rejected: 0, tracking: true },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );

  ({ useAuthStore } = await import("@/store/auth-store"));
});

/** Three points collected on the route, not flushed yet. */
function bufferedTrail(ownerId: string, count = 3): void {
  const start = Date.parse("2026-09-28T17:50:00.000Z");

  local.set(
    "driver_position_state",
    JSON.stringify({
      buffer: Array.from({ length: count }, (_, index) => ({
        latitude: -23.55 + index * 0.01,
        longitude: -46.63,
        accuracy: 10,
        recorded_at: new Date(start + index * 15_000).toISOString(),
      })),
      lastKept: null,
      lastFlushAt: Date.now(),
      stopped: false,
      ownerId,
    }),
  );
}

beforeEach(() => {
  secure.clear();
  local.clear();
  sent.length = 0;
  positionRequests.length = 0;

  secure.set(
    "session_v1",
    JSON.stringify({
      version: 1,
      accessToken: ACCESS_TOKEN,
      refreshToken: "refresh-0",
    }),
  );

  useAuthStore.setState({
    user: DRIVER as never,
    isAuthenticated: true,
    isInitialized: true,
  });
});

describe("logout with points still on the phone", () => {
  it("sends them with the session's token, before the server logout", async () => {
    bufferedTrail("user-1");

    await useAuthStore.getState().logout();

    expect(positionRequests).toEqual([
      { authorization: `Bearer ${ACCESS_TOKEN}`, pings: 3 },
    ]);
    expect(sent).toEqual(["positions", "server-logout"]);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("sends nothing that is another driver's", async () => {
    bufferedTrail("someone-else");

    await useAuthStore.getState().logout();

    expect(positionRequests).toEqual([]);
    expect(sent).toEqual(["server-logout"]);
  });

  it("with nothing buffered, the logout is what it always was", async () => {
    await useAuthStore.getState().logout();

    expect(sent).toEqual(["server-logout"]);
    expect(local.has("driver_position_state")).toBe(false);
  });
});
