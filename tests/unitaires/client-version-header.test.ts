import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appVersionLabel,
  formatClientVersion,
  setClientVersion,
} from "@/utils/client-version";

/**
 * Which build is calling, and which answers the edge gives instead of the API
 * (GAP5-2).
 *
 * The API had no way to say which app builds were still calling — so nobody
 * could tell when an old contract was safe to remove, nor stop a build that
 * had become harmful. Every request now says which build this is.
 *
 * And a 404 that is not JSON is not the API: it is the proxy in front of it,
 * answering while no API replica is up (during a deploy that went wrong). The
 * queue used to fail every item it tried in that window, for good.
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
let ApiError: typeof import("@/utils/api-error").ApiError;

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  ({ apiClient } = await import("@/utils/api"));
  ({ ApiError } = await import("@/utils/api-error"));
});

let sentHeaders: Record<string, string>[] = [];
let answer: () => Response;

beforeEach(() => {
  sentHeaders = [];
  setClientVersion(null);

  answer = () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      sentHeaders.push({ ...(init?.headers as Record<string, string>) });
      return answer();
    }),
  );
});

const THIS_BUILD = {
  platform: "android",
  version: "1.0.0",
  build: 42,
  runtime: "fp-abc123",
  update: "0192f5c0-update",
};

describe("x-trajetto-client-version", () => {
  it("describes the build, the contract and the queue's shape", () => {
    expect(formatClientVersion(THIS_BUILD)).toBe(
      "platform=android; version=1.0.0; build=42; runtime=fp-abc123; update=0192f5c0-update; contract=3; outbox=1",
    );
  });

  it("never lets a value break the header's own separators", () => {
    expect(
      formatClientVersion({ platform: "ios", version: "1.0; build=999" }),
    ).toBe("platform=ios; version=1.0build999; update=embedded; contract=3; outbox=1");
  });

  it("goes with every request once the build is described", async () => {
    setClientVersion(THIS_BUILD);

    await apiClient.post("/user/session", { email: "a@b.c", password: "x" }, false);

    expect(sentHeaders[0]["x-trajetto-client-version"]).toBe(
      formatClientVersion(THIS_BUILD),
    );

    // The refresh policy header is untouched: the API compares it exactly.
    expect(sentHeaders[0]["x-trajetto-client"]).toBe("mobile");
  });

  it("is simply absent before the build is described", async () => {
    await apiClient.post("/user/session", { email: "a@b.c", password: "x" }, false);

    expect(sentHeaders[0]["x-trajetto-client-version"]).toBeUndefined();
  });

  it("gives the outbox a label that changes with any update", () => {
    const before = appVersionLabel(THIS_BUILD);
    const afterOta = appVersionLabel({ ...THIS_BUILD, update: "0192f5c1-next" });
    const afterStore = appVersionLabel({ ...THIS_BUILD, build: 43, runtime: "fp-def" });

    expect(before).not.toBe(afterOta);
    expect(before).not.toBe(afterStore);
    expect(appVersionLabel(null)).toBeNull();
  });
});

describe("a 404 from the edge, not from the API", () => {
  it("is worth trying again", async () => {
    answer = () =>
      new Response("404 page not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });

    const error = await apiClient
      .post("/fuel/create-fuel/business-1", { a: 1 }, false)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).isTransient).toBe(true);
  });

  it("is not confused with the API's own 404", async () => {
    answer = () =>
      new Response(
        JSON.stringify({ code: "ROUTE_NOT_FOUND", message: "Route not found" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );

    const error = await apiClient
      .post("/fuel/create-fuel/business-1", { a: 1 }, false)
      .catch((caught: unknown) => caught);

    expect((error as InstanceType<typeof ApiError>).isTransient).toBe(false);
    expect((error as InstanceType<typeof ApiError>).code).toBe("ROUTE_NOT_FOUND");
  });
});
