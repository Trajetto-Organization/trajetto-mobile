import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A build turned away at launch keeps its session (GAP5-2).
 *
 * The first request of every launch is `GET /user/me`, which the upgrade gate
 * refuses like any other. `checkAuth` read anything that was neither an auth
 * failure nor transient as "non-recoverable" and logged the driver out — so a
 * driver whose app only needed an update lost the session, the drafts and
 * the cache, and after the update had to sign in (and pass 2FA) again before
 * the queue could send anything. A 426 says nothing about the session: the
 * cached one is kept, as when the API is unreachable, and the update screen
 * takes over.
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
  clearQueryCache: vi.fn(async () => undefined),
}));

const clearAllSubmissionData = vi.fn(async () => undefined);

vi.mock("@/features/submissions/submission-id", () => ({
  clearAllSubmissionData: () => clearAllSubmissionData(),
  disableSubmissionPersistence: () => undefined,
  enableSubmissionPersistence: () => undefined,
}));

const signOutRemotely = vi.fn(async () => undefined);

vi.mock("@/features/auth/remote-logout", () => ({
  signOutRemotely: () => signOutRemotely(),
}));

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const now = Math.floor(Date.now() / 1000);

const ACCESS_TOKEN = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "user-1", iat: now, exp: now + 900 })}.signature`;

const CACHED_USER = { id: "user-1", name: "Motorista", email: "m@example.com" };

let useAuthStore: typeof import("@/store/auth-store").useAuthStore;
let useUpgradeStore: typeof import("@/store/upgrade-store").useUpgradeStore;

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  ({ useAuthStore } = await import("@/store/auth-store"));
  ({ useUpgradeStore } = await import("@/store/upgrade-store"));
});

beforeEach(() => {
  secure.clear();
  local.clear();
  clearAllSubmissionData.mockClear();
  signOutRemotely.mockClear();

  secure.set(
    "session_v1",
    JSON.stringify({
      version: 1,
      accessToken: ACCESS_TOKEN,
      refreshToken: "refresh-0",
    }),
  );

  useAuthStore.setState({
    user: CACHED_USER as never,
    isAuthenticated: true,
    isInitialized: false,
  });

  useUpgradeStore.setState({ notice: null, automaticAttempted: false });
});

describe("checkAuth when the build is turned away", () => {
  it("keeps the cached session instead of logging the driver out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "CLIENT_UPGRADE_REQUIRED",
              message: "Esta versão do aplicativo não é mais aceita.",
              minContract: 2,
            }),
            {
              status: 426,
              headers: {
                "content-type": "application/json",
                "x-error-code": "CLIENT_UPGRADE_REQUIRED",
              },
            },
          ),
      ),
    );

    await useAuthStore.getState().checkAuth();

    const state = useAuthStore.getState();

    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toMatchObject({ id: "user-1" });
    expect(state.isInitialized).toBe(true);

    expect(clearAllSubmissionData).not.toHaveBeenCalled();
    expect(signOutRemotely).not.toHaveBeenCalled();
    expect(secure.has("session_v1")).toBe(true);

    // And the update screen is up.
    expect(useUpgradeStore.getState().notice).toEqual({ storeUrl: null });
  });

  it("still logs out on a refusal it cannot recover from", async () => {
    // The rule it sits next to is unchanged: a 400 on /user/me is not a
    // reason to keep a session around.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "SOMETHING", message: "x" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(clearAllSubmissionData).toHaveBeenCalled();
  });
});
