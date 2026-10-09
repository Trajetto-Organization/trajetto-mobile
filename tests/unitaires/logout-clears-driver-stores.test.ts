import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signing out wipes the driver's persisted stores (decision 2.6).
 *
 * The proof warnings carry recipients' names and the problem the reading
 * pointed out; the "a caminho" marks say which stop the driver was heading
 * to. Both were written per driver and nothing removed them at logout, so a
 * shared phone kept them for whoever signed in next. The server serves the
 * marks again (`stops[0].on_the_way_at`) and the inbox the warnings, so the
 * next login loses nothing.
 *
 * The real auth store and the real stores over in-memory storage; only the
 * socket, the query client and the server logout are stubbed.
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
  queryClient: { invalidateQueries: async () => undefined },
}));

vi.mock("@/features/submissions/submission-id", () => ({
  clearAllSubmissionData: async () => undefined,
  disableSubmissionPersistence: () => undefined,
  enableSubmissionPersistence: () => undefined,
}));

vi.mock("@/features/auth/remote-logout", () => ({
  signOutRemotely: async () => undefined,
}));

const PROOF_KEY = "@trajetto:proof-feedback:v1";
const ON_THE_WAY_KEY = "@trajetto:on-the-way:v1";
const PAUSE_KEY = "@trajetto:driver-pause:v1";

const SCOPE = "user-1:business-1";
const DELIVERY = "0192b1c4-0000-4000-8000-000000000001";

let useAuthStore: typeof import("@/store/auth-store").useAuthStore;
let proof: typeof import("@/features/notifications/proof-feedback-store");
let onTheWay: typeof import("@/features/deliveries/on-the-way-store");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    ),
  );

  ({ useAuthStore } = await import("@/store/auth-store"));
  proof = await import("@/features/notifications/proof-feedback-store");
  onTheWay = await import("@/features/deliveries/on-the-way-store");
});

beforeEach(async () => {
  secure.clear();
  local.clear();

  secure.set(
    "session_v1",
    JSON.stringify({ version: 1, accessToken: "access", refreshToken: "refresh" }),
  );

  local.set(
    PROOF_KEY,
    JSON.stringify({
      state: {
        byScope: {
          [SCOPE]: {
            [DELIVERY]: { deliveryId: DELIVERY, message: "Canhoto de Maria sem data", receivedAt: 1 },
          },
        },
        newProofs: { [DELIVERY]: { tappedAt: 1, at: 1 } },
      },
      version: 0,
    }),
  );
  local.set(
    ON_THE_WAY_KEY,
    JSON.stringify({
      state: { byScope: { [SCOPE]: { "stop-1": { at: "2026-10-07T12:00:00.000Z", storedAt: Date.now() } } } },
      version: 0,
    }),
  );
  // The pause is kept on purpose: a start still in the queue is the driver's.
  local.set(PAUSE_KEY, JSON.stringify({ state: { byScope: {}, handoffs: {} }, version: 0 }));

  await Promise.all([proof.hydrateProofFeedbackStore(), onTheWay.hydrateOnTheWayStore()]);

  useAuthStore.setState({
    user: { id: "user-1", name: "Motorista", email: "m@example.com" } as never,
    isAuthenticated: true,
    isInitialized: true,
  });
});

describe("the logout", () => {
  it("starts from stores the disk filled (the harness sees them)", () => {
    expect(Object.keys(proof.useProofFeedbackStore.getState().byScope)).toEqual([SCOPE]);
    expect(Object.keys(onTheWay.useOnTheWayStore.getState().byScope)).toEqual([SCOPE]);
  });

  it("wipes the proof warnings and the 'a caminho' marks, in memory and on disk", async () => {
    await useAuthStore.getState().logout();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    expect(local.has(PROOF_KEY)).toBe(false);
    expect(local.has(ON_THE_WAY_KEY)).toBe(false);
    expect(proof.useProofFeedbackStore.getState().byScope).toEqual({});
    expect(proof.useProofFeedbackStore.getState().newProofs).toEqual({});
    expect(onTheWay.useOnTheWayStore.getState().byScope).toEqual({});

    // What the texts say outlives the logout still does.
    expect(local.has(PAUSE_KEY)).toBe(true);
  });
});
