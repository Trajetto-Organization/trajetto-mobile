import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The failures MOB-10 named, reaching the telemetry pipeline from where they
 * happen: a refresh the API refused (reuse, revocation) and a socket
 * handshake the API refused. Both used to stay in the phone's console.
 */

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

type Handler = (...args: unknown[]) => void;

const socketHandlers = new Map<string, Handler>();

const fakeSocket = {
  active: false,
  connected: false,
  on: (event: string, handler: Handler) => void socketHandlers.set(event, handler),
  connect: () => undefined,
  disconnect: () => undefined,
};

vi.mock("socket.io-client", () => ({ io: () => fakeSocket }));

const sink = vi.fn();

let apiClient: typeof import("@/utils/api").apiClient;
let socketModule: typeof import("@/utils/socket");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  const telemetry = await import("@/utils/telemetry");
  telemetry.setTelemetrySink(sink);

  ({ apiClient } = await import("@/utils/api"));
  socketModule = await import("@/utils/socket");
});

beforeEach(() => sink.mockReset());

describe("the telemetry of a session going wrong", () => {
  it("reports a refresh the API refused, with its code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "AUTH_REFRESH_REUSED" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(apiClient.refreshToken()).resolves.toBeNull();

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "refresh_rejected",
        tags: expect.objectContaining({ code: "AUTH_REFRESH_REUSED" }),
      }),
    );
  });

  it("reports a socket handshake the API refused, with its code", async () => {
    await socketModule.initializeSocket();

    const onError = socketHandlers.get("connect_error");
    expect(onError).toBeDefined();

    // `active` false: the server's middleware said no, not the network.
    onError!(Object.assign(new Error("refused"), { data: { code: "RATE_LIMITED" } }));

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "socket_refused",
        tags: expect.objectContaining({ code: "RATE_LIMITED" }),
      }),
    );
  });
});
