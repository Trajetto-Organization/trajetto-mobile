import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The app says it is the app (AUTH-07).
 *
 * The API gives a session opened by the app a refresh token that survives a
 * week without signal, and keeps the web's at one day. It can only tell them
 * apart by what the request says, so every request — the login and the 2FA
 * step above all, where the session is born — carries `x-trajetto-client`.
 * An older build without it keeps today's one-day session: nothing breaks,
 * it just does not get the longer one.
 */
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@/utils/socket", () => ({
  setSocketTokenRefresher: () => undefined,
  updateSocketAuthToken: async () => undefined,
}));

let apiClient: typeof import("@/utils/api").apiClient;

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  ({ apiClient } = await import("@/utils/api"));
});

let sentHeaders: Record<string, string>[] = [];

beforeEach(() => {
  sentHeaders = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      sentHeaders.push({ ...(init?.headers as Record<string, string>) });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

describe("the client header", () => {
  it("goes with the login", async () => {
    await apiClient.post(
      "/user/session",
      { email: "a@b.c", password: "x" },
      false,
    );

    expect(sentHeaders[0]["x-trajetto-client"]).toBe("mobile");
  });

  it("goes with the two-factor step", async () => {
    await apiClient.post(
      "/user/two-factor-verification",
      { email: "a@b.c", code: "123456" },
      false,
    );

    expect(sentHeaders[0]["x-trajetto-client"]).toBe("mobile");
  });

  it("does not replace a header the caller set", async () => {
    await apiClient.request("/user/logout", {
      method: "POST",
      requiresAuth: false,
      headers: { Authorization: "Bearer t" },
    });

    expect(sentHeaders[0]).toMatchObject({
      Authorization: "Bearer t",
      "x-trajetto-client": "mobile",
    });
  });
});
