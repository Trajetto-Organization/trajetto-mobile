import { beforeAll, describe, expect, it, vi } from "vitest";

import { parseRetryAfter } from "@/utils/api-error";

/**
 * `Retry-After`, from the header to the error the queue reads (MOB-12).
 *
 * The API's limiter and its 503s say how long to wait. The app built its
 * `ApiError` from the status and the body only, so the queue never knew and
 * came back on its own fixed schedule — during the very overload that made
 * the API ask.
 */

describe("reading Retry-After", () => {
  const NOW = Date.parse("2026-09-24T12:00:00Z");

  it("reads delta-seconds", () => {
    expect(parseRetryAfter("120", NOW)).toBe(120_000);
    expect(parseRetryAfter(" 0 ", NOW)).toBe(0);
  });

  it("reads an HTTP-date", () => {
    expect(parseRetryAfter("Thu, 24 Sep 2026 12:00:30 GMT", NOW)).toBe(30_000);
  });

  it("never goes negative for a date already past", () => {
    expect(parseRetryAfter("Thu, 24 Sep 2026 11:00:00 GMT", NOW)).toBe(0);
  });

  it("ignores what it cannot read", () => {
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter("", NOW)).toBeUndefined();
    expect(parseRetryAfter("soon", NOW)).toBeUndefined();
    expect(parseRetryAfter("-5", NOW)).toBeUndefined();
  });
});

// ---------------------------------------------------------- the client
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

const answer = (status: number, headers: Record<string, string> = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Calma", code: "RATE_LIMITED" }), {
          status,
          headers: { "content-type": "application/json", ...headers },
        }),
    ),
  );

describe("the error the client throws", () => {
  it("carries the Retry-After of a 429", async () => {
    answer(429, { "retry-after": "120" });

    await expect(
      apiClient.request("/auth/whatever", { requiresAuth: false }),
    ).rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 });
  });

  it("carries the Retry-After of a 503", async () => {
    answer(503, { "retry-after": "30" });

    await expect(
      apiClient.request("/auth/whatever", { requiresAuth: false }),
    ).rejects.toMatchObject({ status: 503, retryAfterMs: 30_000 });
  });

  it("does not invent one", async () => {
    answer(429);

    const error = await apiClient
      .request("/auth/whatever", { requiresAuth: false })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ status: 429 });
    expect((error as { retryAfterMs?: number }).retryAfterMs).toBeUndefined();
  });
});
