import { describe, expect, it, vi } from "vitest";

import {
  isUpgradeRequired,
  performUpgrade,
  storeUrlFor,
  type UpgradeDeps,
  type UpgradeStep,
} from "@/features/app-update/upgrade-rules";

/**
 * What the app does when the API turns this build away (GAP5-2).
 *
 * Below MIN_MOBILE_CONTRACT the API answers 426 CLIENT_UPGRADE_REQUIRED to
 * every request but the session ones. The app used to show that as one more
 * error toast, on every screen, with nothing the driver could do about it.
 * Now one blocking screen takes over, and the way out is in this order:
 *
 * - an over-the-air update for THIS runtime, when one exists: downloaded and
 *   applied on the spot, the driver never leaves the app;
 * - otherwise the store page — the API's `storeUrl` when it sent one, the
 *   app's own Play Store page when not.
 *
 * Nothing here decides anything about the queue: an item the API refused
 * with 426 is a contract failure, kept on the phone and sent again by itself
 * once the app is updated.
 */
describe("the answer that means 'update the app'", () => {
  it("is the gate's 426, by its code", () => {
    expect(isUpgradeRequired(426, "CLIENT_UPGRADE_REQUIRED")).toBe(true);
  });

  it("is nothing else", () => {
    // A 426 somebody else sent (a proxy asking for another protocol) says
    // nothing about this build; a refusal on the merits even less.
    expect(isUpgradeRequired(426, undefined)).toBe(false);
    expect(isUpgradeRequired(426, "SOMETHING_ELSE")).toBe(false);
    expect(isUpgradeRequired(400, "CLIENT_UPGRADE_REQUIRED")).toBe(false);
    expect(isUpgradeRequired(400, "VALIDATION_ERROR")).toBe(false);
  });
});

describe("the store page", () => {
  const PACKAGE = "com.trajetto.fleetmanager";
  const PLAY = `https://play.google.com/store/apps/details?id=${PACKAGE}`;

  it("is the one the API named, when it named one", () => {
    const fromApi = "https://trajetto.com.br/app";

    expect(storeUrlFor(fromApi, PACKAGE)).toBe(fromApi);
  });

  it("is the app's own Play Store page when the API named none", () => {
    expect(storeUrlFor(undefined, PACKAGE)).toBe(PLAY);
    expect(storeUrlFor(null, PACKAGE)).toBe(PLAY);
  });

  it("never opens something that is not an https page", () => {
    // The phone hands it to the OS, where another scheme starts another app.
    expect(storeUrlFor("http://play.google.com/store", PACKAGE)).toBe(PLAY);
    expect(storeUrlFor("intent://evil#Intent;end", PACKAGE)).toBe(PLAY);
    expect(storeUrlFor("javascript:alert(1)", PACKAGE)).toBe(PLAY);
    expect(storeUrlFor("https://play.google.com/ x", PACKAGE)).toBe(PLAY);
    expect(storeUrlFor(42, PACKAGE)).toBe(PLAY);
  });

  it("is none at all when neither side can tell", () => {
    expect(storeUrlFor(undefined, undefined)).toBeNull();
    expect(storeUrlFor(undefined, "not a package; drop")).toBeNull();
  });
});

describe("the way out", () => {
  const STORE = "https://play.google.com/store/apps/details?id=com.trajetto.fleetmanager";

  function deps(overrides: Partial<UpgradeDeps> = {}) {
    const steps: UpgradeStep[] = [];

    const base: UpgradeDeps = {
      updatesEnabled: true,
      checkForUpdate: vi.fn(async () => ({ isAvailable: false })),
      fetchUpdate: vi.fn(async () => ({ isNew: true })),
      reload: vi.fn(async () => undefined),
      openStore: vi.fn(async () => undefined),
      onStep: (step) => steps.push(step),
      timeoutMs: 1_000,
      ...overrides,
    };

    return { deps: base, steps };
  }

  it("takes the over-the-air update when this runtime has one, without the store", async () => {
    const { deps: d, steps } = deps({
      checkForUpdate: vi.fn(async () => ({ isAvailable: true })),
    });

    await expect(performUpgrade(STORE, d)).resolves.toBe("restarting");

    expect(d.fetchUpdate).toHaveBeenCalledTimes(1);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.openStore).not.toHaveBeenCalled();
    expect(steps).toEqual(["checking", "downloading", "restarting"]);
  });

  it("goes to the store when there is no update for this runtime", async () => {
    // A fix that needed native code: no bundle for the old runtime exists.
    const { deps: d, steps } = deps();

    await expect(performUpgrade(STORE, d)).resolves.toBe("store");

    expect(d.fetchUpdate).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.openStore).toHaveBeenCalledWith(STORE);
    expect(steps).toEqual(["checking", "store"]);
  });

  it("goes to the store when updates are off in this build", async () => {
    const { deps: d } = deps({ updatesEnabled: false });

    await expect(performUpgrade(STORE, d)).resolves.toBe("store");

    expect(d.checkForUpdate).not.toHaveBeenCalled();
    expect(d.openStore).toHaveBeenCalledWith(STORE);
  });

  it("goes to the store when asking for an update fails", async () => {
    const { deps: d } = deps({
      checkForUpdate: vi.fn(async () => {
        throw new Error("network");
      }),
    });

    await expect(performUpgrade(STORE, d)).resolves.toBe("store");
    expect(d.openStore).toHaveBeenCalledWith(STORE);
  });

  it("goes to the store when asking for an update never answers", async () => {
    vi.useFakeTimers();

    try {
      const { deps: d } = deps({
        checkForUpdate: vi.fn(() => new Promise<{ isAvailable: boolean }>(() => {})),
      });

      const result = performUpgrade(STORE, d);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(result).resolves.toBe("store");
      expect(d.openStore).toHaveBeenCalledWith(STORE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not restart into the bundle it already runs", async () => {
    // `isNew: false`: what was downloaded is what is running — restarting
    // would come back to the same 426.
    const { deps: d } = deps({
      checkForUpdate: vi.fn(async () => ({ isAvailable: true })),
      fetchUpdate: vi.fn(async () => ({ isNew: false })),
    });

    await expect(performUpgrade(STORE, d)).resolves.toBe("store");

    expect(d.reload).not.toHaveBeenCalled();
    expect(d.openStore).toHaveBeenCalledWith(STORE);
  });

  it("goes to the store when the download or the restart fails", async () => {
    const failedDownload = deps({
      checkForUpdate: vi.fn(async () => ({ isAvailable: true })),
      fetchUpdate: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    await expect(performUpgrade(STORE, failedDownload.deps)).resolves.toBe("store");

    const failedRestart = deps({
      checkForUpdate: vi.fn(async () => ({ isAvailable: true })),
      reload: vi.fn(async () => {
        throw new Error("reload refused");
      }),
    });

    await expect(performUpgrade(STORE, failedRestart.deps)).resolves.toBe("store");
    expect(failedRestart.deps.openStore).toHaveBeenCalledWith(STORE);
  });

  it("says so when there is no store page to open", async () => {
    const { deps: d, steps } = deps();

    await expect(performUpgrade(null, d)).resolves.toBe("no-store");

    expect(d.openStore).not.toHaveBeenCalled();
    expect(steps.at(-1)).toBe("no-store");
  });

  it("says so when the store page would not open", async () => {
    const { deps: d } = deps({
      openStore: vi.fn(async () => {
        throw new Error("no activity");
      }),
    });

    await expect(performUpgrade(STORE, d)).resolves.toBe("no-store");
  });
});
