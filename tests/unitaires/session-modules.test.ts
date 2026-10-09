import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetModuleObservations,
  moduleObservation,
} from "@/features/access/module-observations";

/**
 * The plan the session keeps, and what it tells the offline queue.
 *
 * - A company user's `/user/me` is the company's plan: the queue hears it, so
 *   submissions parked while a module was off go out once it is back (MOB-03)
 *   — including after the re-read `entitlementsChanged` triggers (MOB-11).
 * - A MASTER's `/user/me` answers every module; the app shows the SELECTED
 *   company's plan instead (decision 4.3) and never lets the previous
 *   company's plan ride along to the next one.
 *
 * Runs the real auth store over in-memory storage, like
 * upgrade-required-session.test.ts.
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

vi.mock("@/features/submissions/submission-id", () => ({
  clearAllSubmissionData: async () => undefined,
  disableSubmissionPersistence: () => undefined,
  enableSubmissionPersistence: () => undefined,
}));

vi.mock("@/features/auth/remote-logout", () => ({
  signOutRemotely: async () => undefined,
}));

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const now = Math.floor(Date.now() / 1000);

const ACCESS_TOKEN = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "u1", iat: now, exp: now + 900 })}.signature`;

let store: typeof import("@/store/auth-store");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  store = await import("@/store/auth-store");
});

const driver = (enabledModules: string[]) => ({
  id: "u1",
  name: "Motorista",
  email: "m@exemplo.com.br",
  role: "BUSINESS_USER" as const,
  businessId: "b1",
  driverId: "d1",
  enabledModules,
});

const master = (businessId: string | null, enabledModules?: string[]) => ({
  id: "m1",
  name: "Master",
  email: "master@exemplo.com.br",
  role: "MASTER" as const,
  businessId,
  selectedBusiness: businessId ? `Empresa ${businessId}` : null,
  enabledModules,
});

beforeEach(() => {
  secure.clear();
  local.clear();
  forgetModuleObservations();
  store.useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe("a company user's /user/me", () => {
  it("is told to the offline queue as the company's plan", () => {
    store.useAuthStore.getState().setServerUser(driver(["FLEET"]) as never);

    expect(moduleObservation("b1", "FLEET")).toMatchObject({ enabled: true });
    expect(moduleObservation("b1", "DELIVERIES")).toMatchObject({
      enabled: false,
    });
  });

  it("is told on the launch check too, not only on a later re-read", async () => {
    secure.set(
      "session_v1",
      JSON.stringify({ version: 1, accessToken: ACCESS_TOKEN, refreshToken: "r" }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ message: "ok", user: driver(["DELIVERIES"]) }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await store.useAuthStore.getState().checkAuth();

    expect(store.useAuthStore.getState().isAuthenticated).toBe(true);
    expect(moduleObservation("b1", "DELIVERIES")).toMatchObject({
      enabled: true,
    });
  });
});

describe("a MASTER", () => {
  it("keeps the selected company's plan when /user/me answers with every module", () => {
    store.useAuthStore.setState({ user: master("b2", ["DELIVERIES"]) as never });

    store.useAuthStore
      .getState()
      .setServerUser(master(null, ["FLEET", "DELIVERIES"]) as never);

    const user = store.useAuthStore.getState().user;

    expect(user?.businessId).toBe("b2");
    expect(user?.enabledModules).toEqual(["DELIVERIES"]);

    // "Every module" is not a company's plan: the queue hears nothing.
    expect(moduleObservation("b2", "FLEET")).toBeNull();
  });

  it("forgets the previous company's plan on switching company", () => {
    store.useAuthStore.setState({ user: master("b1", ["FLEET"]) as never });

    store.useAuthStore
      .getState()
      .setUser({ ...master("b3"), enabledModules: ["FLEET"] } as never);

    expect(store.useAuthStore.getState().user?.enabledModules).toBeUndefined();
  });

  it("takes the plan the endpoint gave for the company still selected", () => {
    store.useAuthStore.setState({ user: master("b3") as never });

    store.applyBusinessModules("b3", ["DELIVERIES"], 5_000);

    expect(store.useAuthStore.getState().user?.enabledModules).toEqual([
      "DELIVERIES",
    ]);
    expect(moduleObservation("b3", "DELIVERIES")).toEqual({
      enabled: true,
      observedAt: 5_000,
    });
  });

  it("ignores an answer about a company no longer selected", () => {
    store.useAuthStore.setState({ user: master("b3") as never });

    store.applyBusinessModules("b2", ["FLEET"], 5_000);

    expect(store.useAuthStore.getState().user?.enabledModules).toBeUndefined();
  });
});

describe("a company user", () => {
  it("never has the plan replaced by the MASTER's endpoint path", () => {
    store.useAuthStore.setState({ user: driver(["DELIVERIES"]) as never });

    store.applyBusinessModules("b1", ["FLEET", "DELIVERIES"], 5_000);

    expect(store.useAuthStore.getState().user?.enabledModules).toEqual([
      "DELIVERIES",
    ]);
  });
});
