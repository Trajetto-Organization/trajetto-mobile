import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A phone whose clock is wrong.
 *
 * The app decides whether its access token is still good by comparing `exp`
 * with the PHONE's clock. A clock set by hand twenty minutes ahead made every
 * fresh token look expired — the server's `exp` is fifteen minutes after the
 * server's `now` — so every single request refreshed first. Ten refreshes a
 * minute is the API's limit; after that the refresh answers 429 and the app
 * stops working for that driver (MOB-14).
 *
 * The fix learns the offset from `iat`: the token was issued by the server's
 * clock a moment ago, when it is stored.
 */

const SERVER_NOW = 1_800_000_000; // seconds, the API's clock
const AHEAD = 20 * 60; // the phone's clock, twenty minutes ahead

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const jwt = (payload: { iat: number; exp: number }) =>
  `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "user-1", role: "DRIVER", ...payload })}.signature`;

const issuedAt = (iat: number) => jwt({ iat, exp: iat + 900 });

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

let jwtModule: typeof import("@/utils/jwt");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  jwtModule = await import("@/utils/jwt");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("whether a token is expired, on a phone with the wrong time", () => {
  beforeEach(() => jwtModule.resetClockSkew());

  it("trusts a token the server has just issued, once it has seen one", () => {
    const token = issuedAt(SERVER_NOW);
    const phoneNowMs = (SERVER_NOW + AHEAD) * 1000;

    jwtModule.rememberClockSkewFrom(token, phoneNowMs);

    expect(jwtModule.isTokenExpired(token, phoneNowMs)).toBe(false);

    // And it still expires: fifteen minutes later on the same wrong clock.
    expect(jwtModule.isTokenExpired(token, phoneNowMs + 900 * 1000)).toBe(true);
  });

  it("works the same when the phone is behind", () => {
    const token = issuedAt(SERVER_NOW);
    const phoneNowMs = (SERVER_NOW - AHEAD) * 1000;

    jwtModule.rememberClockSkewFrom(token, phoneNowMs);

    expect(jwtModule.isTokenExpired(token, phoneNowMs + 800 * 1000)).toBe(false);
    expect(jwtModule.isTokenExpired(token, phoneNowMs + 900 * 1000)).toBe(true);
  });

  it("refreshes a few seconds early, so a token does not expire in flight", () => {
    const nowMs = SERVER_NOW * 1000;

    expect(
      jwtModule.isTokenExpired(jwt({ iat: SERVER_NOW - 895, exp: SERVER_NOW + 5 }), nowMs),
    ).toBe(true);
    expect(
      jwtModule.isTokenExpired(jwt({ iat: SERVER_NOW, exp: SERVER_NOW + 60 }), nowMs),
    ).toBe(false);
  });

  it("ignores a token that carries no issue time", () => {
    const phoneNowMs = (SERVER_NOW + AHEAD) * 1000;
    const noIat = `${encode({ alg: "HS256" })}.${encode({ exp: SERVER_NOW + 900 })}.s`;

    jwtModule.rememberClockSkewFrom(noIat, phoneNowMs);

    expect(jwtModule.isTokenExpired(issuedAt(SERVER_NOW), phoneNowMs)).toBe(true);
  });

  it("reads a payload encoded as base64url", () => {
    // `>` and `?` at the right offset turn into `-` and `_` in base64url,
    // which a plain `atob` refuses: the token then read as expired, forever.
    const token = `${encode({ alg: "HS256" })}.${encode({ exp: SERVER_NOW + 900, iat: SERVER_NOW, n: "a>>?" })}.s`;
    expect(token.split(".")[1]).toMatch(/[-_]/);

    expect(jwtModule.parseJwt(token)?.exp).toBe(SERVER_NOW + 900);
  });
});

describe("the API client on a phone twenty minutes ahead", () => {
  it("refreshes once, not before every request", async () => {
    // A fresh launch: nothing learned about this clock yet.
    vi.resetModules();
    const { apiClient } = await import("@/utils/api");

    // A session stored before this launch: the skew is not known yet.
    secure.set(
      "session_v1",
      JSON.stringify({
        version: 1,
        accessToken: issuedAt(SERVER_NOW - 60),
        refreshToken: "refresh-0",
      }),
    );

    vi.spyOn(Date, "now").mockReturnValue((SERVER_NOW + AHEAD) * 1000);

    let refreshes = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/user/refresh-token")) {
          refreshes += 1;

          return new Response(
            JSON.stringify({
              token: issuedAt(SERVER_NOW),
              refresh_token: `refresh-${refreshes}`,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    for (let i = 0; i < 5; i += 1) {
      await apiClient.get("/my-deliveries");
    }

    expect(refreshes).toBe(1);
  });
});
