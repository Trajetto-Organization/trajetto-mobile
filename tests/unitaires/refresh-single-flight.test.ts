import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One refresh for a burst of requests (TESTS-11).
 *
 * When the outbox comes back online it fires several requests at once — the
 * queue, the deliveries list, the chat — and the access token has usually
 * expired while the phone was out of signal. Each of them used to be free to
 * refresh on its own. The API rotates the refresh token on every use and
 * treats a second use of the old one as theft (AUTH_REFRESH_REUSED): five
 * parallel refreshes are one success and four logouts. The client keeps a
 * single refresh in flight and every request waits on it; nothing tested it.
 */
const SERVER_NOW = Math.floor(Date.now() / 1000);

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const token = (iat: number, label: string) =>
  `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "user-1", iat, exp: iat + 900, label })}.signature`;

// ---------------------------------------------------------------- natives
const secure = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secure.set(key, value),
  deleteItemAsync: async (key: string) => void secure.delete(key),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    multiRemove: async () => undefined,
    getAllKeys: async () => [],
  },
}));

vi.mock("@/utils/socket", () => ({
  setSocketTokenRefresher: () => undefined,
  updateSocketAuthToken: async () => undefined,
}));

let apiClient: typeof import("@/utils/api").apiClient;

const FRESH = token(SERVER_NOW, "fresh");

let refreshes = 0;
let bearers: string[] = [];

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  ({ apiClient } = await import("@/utils/api"));
});

function storeSession(accessToken: string) {
  secure.set(
    "session_v1",
    JSON.stringify({ version: 1, accessToken, refreshToken: "refresh-0" }),
  );
}

beforeEach(() => {
  secure.clear();
  refreshes = 0;
  bearers = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/user/refresh-token")) {
        refreshes += 1;

        // Slow enough that every request in the burst is waiting on it.
        await new Promise((resolve) => setTimeout(resolve, 20));

        return new Response(
          JSON.stringify({ token: FRESH, refresh_token: `refresh-${refreshes}` }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const authorization =
        (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";

      bearers.push(authorization);

      // The server refuses anything but the renewed token.
      if (authorization !== `Bearer ${FRESH}`) {
        return new Response(JSON.stringify({ message: "Token expirado" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

describe("a burst of requests on an expired session", () => {
  it("refreshes once, and every request goes out with the new token", async () => {
    // Expired an hour ago, by the phone's own reading.
    storeSession(token(SERVER_NOW - 3_600, "expired"));

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) => apiClient.get(`/resource/${index}`)),
    );

    expect(results).toHaveLength(5);
    expect(refreshes).toBe(1);
    expect(bearers).toHaveLength(5);
    expect(new Set(bearers)).toEqual(new Set([`Bearer ${FRESH}`]));
  });

  it("refreshes once when the server is the one that says the token is dead", async () => {
    // Looks valid to the phone; the server revoked it (a 401 per request).
    storeSession(token(SERVER_NOW, "revoked-by-server"));

    await Promise.all(
      Array.from({ length: 5 }, (_, index) => apiClient.get(`/resource/${index}`)),
    );

    expect(refreshes).toBe(1);
  });
});
