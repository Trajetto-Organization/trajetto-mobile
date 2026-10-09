import { afterEach, describe, expect, it, vi } from "vitest";

import { releaseApiUrlProblem } from "@/utils/api-url-rules";

/**
 * Which API a published bundle may talk to (GAP4-11, MOB-11).
 *
 * `app.config.js` refuses a non-HTTPS or private API URL — but only when
 * `EAS_BUILD_PROFILE` is set, and that variable exists only in EAS Build. An
 * `eas update` publishes a bundle with whatever `EXPO_PUBLIC_API_URL` the
 * publishing machine had, checked by nobody. The bundle itself now refuses,
 * which covers every way a bundle can be made.
 */

describe("the API URL a release bundle accepts", () => {
  it.each([
    "https://trajettoapi.thorsolucoes.com.br",
    "https://trajettoapi.thorsolucoes.com.br/",
    "https://api.trajetto.com.br:8443",
  ])("accepts %s", (url) => {
    expect(releaseApiUrlProblem(url)).toBeNull();
  });

  it.each([
    ["no URL at all", undefined],
    ["an empty one", ""],
    ["something that is not a URL", "api.trajetto.com.br"],
    ["cleartext", "http://api.trajetto.com.br"],
    ["credentials", "https://user:senha@api.trajetto.com.br"],
    ["a query string", "https://api.trajetto.com.br/?x=1"],
    ["a fragment", "https://api.trajetto.com.br/#x"],
    ["a LAN address", "https://192.168.0.10:3333"],
    ["a private address", "https://10.0.0.5"],
    ["the emulator's host", "https://10.0.2.2"],
    ["localhost", "https://localhost"],
    ["a .local name", "https://api.local"],
    ["an IPv6 unique-local address", "https://[fd00::1]"],
  ])("refuses %s", (_label, url) => {
    expect(releaseApiUrlProblem(url)).toEqual(expect.any(String));
  });
});

// ------------------------------------------------------------- the wiring
// A signed-in driver, so the socket gets as far as choosing where to connect.
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) =>
    key === "session_v1"
      ? JSON.stringify({ version: 1, accessToken: "a", refreshToken: "r" })
      : null,
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

const io = vi.fn(() => ({
  on: () => undefined,
  connect: () => undefined,
  disconnect: () => undefined,
}));

vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => io(...(args as [])),
}));

const fetchMock = vi.fn(
  async () =>
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
);

/** A fresh app launch with this bundle's flavour and URL. */
const launch = async (isDev: boolean, apiUrl: string) => {
  vi.resetModules();
  vi.stubGlobal("__DEV__", isDev);
  vi.stubGlobal("fetch", fetchMock);
  process.env.EXPO_PUBLIC_API_URL = apiUrl;

  const [{ apiClient }, socket] = await Promise.all([
    import("@/utils/api"),
    import("@/utils/socket"),
  ]);

  return { apiClient, socket };
};

describe("a published bundle built with a LAN API URL", () => {
  afterEach(() => {
    fetchMock.mockClear();
    io.mockClear();
  });

  it("never sends a request to it", async () => {
    const { apiClient } = await launch(false, "http://192.168.0.10:3333");

    await expect(
      apiClient.request("/health", { requiresAuth: false }),
    ).rejects.toMatchObject({ name: "ApiError" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails like an unreachable API, so the session and the queue survive", async () => {
    /**
     * A refusal classified as final would log every driver out (`checkAuth`
     * ends the session on a non-transient failure) and mark every queued
     * proof as failed. The bundle is what is wrong, and the next OTA fixes
     * it; nothing about the driver's work or session is.
     */
    const { apiClient } = await launch(false, "http://192.168.0.10:3333");

    const error = await apiClient
      .request("/health", { requiresAuth: false })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ isTransient: true, isAuthenticationError: false });
  });

  it("does not open the socket to it", async () => {
    const { socket } = await launch(false, "http://192.168.0.10:3333");

    await expect(socket.reconnectSocket()).rejects.toThrow();
    expect(io).not.toHaveBeenCalled();
  });

  it("is still allowed in a development bundle, against a laptop on the LAN", async () => {
    const { apiClient } = await launch(true, "http://192.168.0.10:3333");

    await apiClient.request("/health", { requiresAuth: false });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.0.10:3333/health",
      expect.anything(),
    );
  });

  it("talks to a public HTTPS API as before", async () => {
    const { apiClient } = await launch(false, "https://trajettoapi.thorsolucoes.com.br/");

    await apiClient.request("/health", { requiresAuth: false });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://trajettoapi.thorsolucoes.com.br/health",
      expect.anything(),
    );
  });
});
