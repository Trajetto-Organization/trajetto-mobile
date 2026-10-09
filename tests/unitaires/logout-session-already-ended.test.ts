import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signing out when the server had already ended the session.
 *
 * The app E2E saw POST /user/logout answer 401 AUTH_SESSION_INVALIDATED: the
 * session's refresh family was gone before the driver pressed "Sair" (a
 * forced logout, or another device revoked it). The local logout must finish
 * exactly as it does after a 200 — signed out, credentials gone, the same
 * outbox handling — with no error toast and nothing logged as an error.
 *
 * The real auth store, the real remote logout and the real API client, over
 * in-memory storage and a stubbed `fetch`.
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
  getRegisteredPushToken: () => "ExponentPushToken[abc]",
  setRegisteredPushToken: () => undefined,
}));

vi.mock("@/providers/query-provider", () => ({
  clearQueryCache: async () => undefined,
}));

const outbox = vi.hoisted(() => ({
  clearAllSubmissionData: vi.fn(async () => undefined),
  disableSubmissionPersistence: vi.fn(() => undefined),
}));

vi.mock("@/features/submissions/submission-id", () => ({
  clearAllSubmissionData: outbox.clearAllSubmissionData,
  disableSubmissionPersistence: outbox.disableSubmissionPersistence,
  enableSubmissionPersistence: () => undefined,
}));

const toast = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock("react-native-toast-message", () => ({ default: toast, show: toast.show }));

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

const now = Math.floor(Date.now() / 1000);

const ACCESS_TOKEN = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "user-1", iat: now, exp: now + 900 })}.signature`;

const DRIVER = { id: "user-1", name: "Motorista", email: "m@example.com" };

/** How the API answers POST /user/logout in the current test. */
let logoutAnswer: () => Response = () => new Response("{}", { status: 200 });

const requests: string[] = [];

let useAuthStore: typeof import("@/store/auth-store").useAuthStore;

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = String(url).replace("https://api.trajetto.test", "");

      requests.push(`${init.method ?? "GET"} ${path}`);

      if (path === "/user/logout") return logoutAnswer();

      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }),
  );

  ({ useAuthStore } = await import("@/store/auth-store"));
});

beforeEach(() => {
  secure.clear();
  local.clear();
  requests.length = 0;
  outbox.clearAllSubmissionData.mockClear();
  outbox.disableSubmissionPersistence.mockClear();
  toast.show.mockClear();

  secure.set(
    "session_v1",
    JSON.stringify({ version: 1, accessToken: ACCESS_TOKEN, refreshToken: "refresh-0" }),
  );

  useAuthStore.setState({ user: DRIVER as never, isAuthenticated: true, isInitialized: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function signOut() {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

  await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();

  return {
    errors: errors.mock.calls.length,
    signedIn: useAuthStore.getState().isAuthenticated,
    user: useAuthStore.getState().user,
    session: secure.get("session_v1") ?? null,
    outboxCleared: outbox.clearAllSubmissionData.mock.calls.length,
    outboxPersistenceOff: outbox.disableSubmissionPersistence.mock.calls.length,
    toasts: toast.show.mock.calls.length,
    requests: [...requests],
  };
}

describe("logout when POST /user/logout answers 401 AUTH_SESSION_INVALIDATED", () => {
  it("finishes the local logout exactly as after a 200, with no error toast or log", async () => {
    logoutAnswer = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    const normal = await signOut();

    secure.set(
      "session_v1",
      JSON.stringify({ version: 1, accessToken: ACCESS_TOKEN, refreshToken: "refresh-0" }),
    );
    useAuthStore.setState({ user: DRIVER as never, isAuthenticated: true, isInitialized: true });
    requests.length = 0;
    outbox.clearAllSubmissionData.mockClear();
    outbox.disableSubmissionPersistence.mockClear();

    logoutAnswer = () =>
      new Response(
        JSON.stringify({ code: "AUTH_SESSION_INVALIDATED", message: "Sessão expirada ou encerrada." }),
        { status: 401, headers: { "content-type": "application/json", "x-error-code": "AUTH_SESSION_INVALIDATED" } },
      );
    const ended = await signOut();

    // The server was asked, in the same order, both times.
    expect(ended.requests).toEqual(["DELETE /notification/push-token", "POST /user/logout"]);
    expect(ended.requests).toEqual(normal.requests);

    // Signed out, credentials gone.
    expect(ended.signedIn).toBe(false);
    expect(ended.user).toBeNull();
    expect(ended.session).toBeNull();

    // The outbox is handled the same way as on any logout.
    expect(ended.outboxCleared).toBe(normal.outboxCleared);
    expect(ended.outboxPersistenceOff).toBe(normal.outboxPersistenceOff);

    // Nothing to tell the driver, nothing logged as an error.
    expect(ended.toasts).toBe(0);
    expect(ended.errors).toBe(0);
  });
});
