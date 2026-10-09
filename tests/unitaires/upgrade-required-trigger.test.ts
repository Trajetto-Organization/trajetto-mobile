import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyFailure } from "@/features/submissions/outbox-rules";

/**
 * Any request can raise the update screen, once (GAP5-2).
 *
 * The 426 can come back from whatever the app happens to be doing — a list
 * refreshing, the outbox draining, a fueling being sent — so the client
 * itself notices it, not each screen. It raises the blocking screen the first
 * time and ignores every 426 after that: the queue and the lists keep asking
 * while the screen is up, and each of those answers must not start the
 * update over again. The error is still thrown as before, so the outbox files
 * the item as a contract failure and keeps it.
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
let upgradeStore: typeof import("@/store/upgrade-store");

const STORE = "https://play.google.com/store/apps/details?id=com.trajetto.fleetmanager";

let respond: () => Response;

const upgradeRequired = (storeUrl?: string) =>
  new Response(
    JSON.stringify({
      code: "CLIENT_UPGRADE_REQUIRED",
      message: "Esta versão do aplicativo não é mais aceita.",
      minContract: 2,
      ...(storeUrl ? { storeUrl } : {}),
    }),
    {
      status: 426,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-error-code": "CLIENT_UPGRADE_REQUIRED",
      },
    },
  );

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  ({ apiClient } = await import("@/utils/api"));
  upgradeStore = await import("@/store/upgrade-store");
});

beforeEach(() => {
  upgradeStore.useUpgradeStore.setState({
    notice: null,
    automaticAttempted: false,
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => respond()),
  );
});

const list = () =>
  apiClient.request("/vehicle/list-vehicle", { requiresAuth: false });

describe("a 426 from the upgrade gate", () => {
  it("raises the update screen, with the store page the API named", async () => {
    respond = () => upgradeRequired(STORE);

    await expect(list()).rejects.toMatchObject({
      status: 426,
      code: "CLIENT_UPGRADE_REQUIRED",
    });

    expect(upgradeStore.useUpgradeStore.getState().notice).toEqual({
      storeUrl: STORE,
    });
  });

  it("raises it without a store page when the API named none", async () => {
    respond = () => upgradeRequired();

    await expect(list()).rejects.toMatchObject({ status: 426 });

    expect(upgradeStore.useUpgradeStore.getState().notice).toEqual({
      storeUrl: null,
    });
  });

  it("raises it once, however many requests meet the gate after that", async () => {
    const changes = vi.fn();
    const unsubscribe = upgradeStore.useUpgradeStore.subscribe(changes);

    try {
      respond = () => upgradeRequired(STORE);
      await expect(list()).rejects.toMatchObject({ status: 426 });

      respond = () => upgradeRequired("https://example.com/other");
      await expect(list()).rejects.toMatchObject({ status: 426 });
      await expect(list()).rejects.toMatchObject({ status: 426 });

      expect(changes).toHaveBeenCalledTimes(1);
      expect(upgradeStore.useUpgradeStore.getState().notice).toEqual({
        storeUrl: STORE,
      });
    } finally {
      unsubscribe();
    }
  });

  it("still fails the request as a contract failure, which the outbox keeps", async () => {
    respond = () => upgradeRequired(STORE);

    const error = await list().catch((thrown: unknown) => thrown);

    expect(
      classifyFailure({
        source: "api",
        isAuthenticationError: (error as { isAuthenticationError: boolean })
          .isAuthenticationError,
        isTransient: (error as { isTransient: boolean }).isTransient,
        code: (error as { code?: string }).code,
      }),
    ).toBe("contract");
  });
});

describe("anything else", () => {
  it("never raises the update screen", async () => {
    respond = () =>
      new Response(JSON.stringify({ code: "VALIDATION_ERROR", message: "x" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });

    await expect(list()).rejects.toMatchObject({ status: 400 });

    // A 426 without the gate's code is somebody else's.
    respond = () => new Response("Upgrade Required", { status: 426 });

    await expect(list()).rejects.toMatchObject({ status: 426 });

    expect(upgradeStore.useUpgradeStore.getState().notice).toBeNull();
  });
});

describe("the automatic attempt", () => {
  it("is claimed once per launch; after that only the driver starts one", () => {
    expect(upgradeStore.claimAutomaticUpgrade("active")).toBe(true);
    expect(upgradeStore.claimAutomaticUpgrade("active")).toBe(false);
    expect(upgradeStore.claimAutomaticUpgrade("active")).toBe(false);
  });

  it("waits for the app to be in front of the driver", () => {
    /**
     * The tracking flush keeps sending while the app is in the background —
     * the driver navigating in another app — and meets the gate there too.
     * Restarting the app, or opening the store over the navigation, is not
     * something to do behind the driver's back; and spending the one attempt
     * where nobody sees it left the driver only a button on return.
     */
    expect(upgradeStore.claimAutomaticUpgrade("background")).toBe(false);
    expect(upgradeStore.claimAutomaticUpgrade("inactive")).toBe(false);

    expect(upgradeStore.claimAutomaticUpgrade("active")).toBe(true);
    expect(upgradeStore.claimAutomaticUpgrade("active")).toBe(false);
  });

  it("is started by the screen from the app's state, and again when it comes to the front", () => {
    // Rendering React Native is out of reach here; the rule above is only
    // worth something if the screen hands it the real state and follows it.
    const screen = readFileSync(
      resolve(process.cwd(), "components/upgrade-required-screen.tsx"),
      "utf8",
    );

    expect(screen).toMatch(/AppState\.addEventListener\(\s*"change"/);
    expect(screen).toMatch(/claimAutomaticUpgrade\(appState\)/);
  });
});

describe("the screen", () => {
  it("is mounted by the root layout, over every route", () => {
    // Rendering React Native is out of reach here (plain Node), so this reads
    // the layout: a notice nobody renders is a 426 shown as an error again.
    const layout = readFileSync(
      resolve(process.cwd(), "app/_layout.tsx"),
      "utf8",
    );

    expect(layout).toMatch(
      /import \{ UpgradeRequiredScreen \} from "\.\.\/components\/upgrade-required-screen";/,
    );
    expect(layout).toMatch(/<UpgradeRequiredScreen \/>/);
  });
});
