/**
 * What the app does when the API turns this build away (GAP5-2).
 *
 * Below MIN_MOBILE_CONTRACT the API answers 426 CLIENT_UPGRADE_REQUIRED to
 * every request except the session ones, and nothing the driver can do on
 * this build changes that. So one blocking screen takes over (see
 * `components/upgrade-required-screen.tsx`), and the way out is tried in
 * order: an over-the-air update for THIS runtime, applied on the spot; when
 * there is none, the store page.
 *
 * Kept free of imports, like the other rule files, so the whole sequence is
 * tested under plain Node: the screen hands in expo-updates and Linking.
 */

const UPGRADE_REQUIRED_CODE = "CLIENT_UPGRADE_REQUIRED";

/**
 * Whether an answer is the upgrade gate's.
 *
 * By its code, not by the status alone: a 426 from anything in front of the
 * API (a proxy asking for another protocol) says nothing about this build,
 * and taking over the whole app over it would be absurd. The code also
 * arrives in `x-error-code`, which `api.ts` already falls back to.
 */
function isUpgradeRequired(
  status: number,
  code: string | null | undefined,
): boolean {
  return status === 426 && code === UPGRADE_REQUIRED_CODE;
}

// An https page and nothing else. A pattern and not `new URL`, for the reason
// `notification-link-rules.ts` gives: React Native's URL does not implement
// `protocol` or `host`. No whitespace or control characters anywhere.
const HTTPS_PAGE = /^https:\/\/[^/\\?#@\s]+(?:[/?#][^\s\u0000-\u001f\u007f]*)?$/i;

// An Android application id: dot-separated Java identifiers.
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

/**
 * The store page to send the driver to, or null when there is none to name.
 *
 * The API's `storeUrl` (MOBILE_STORE_URL) wins, so the link can move without
 * a new build. Without it — the variable unset, or an API older than the
 * field — the app's own Play Store page, from its package name. Anything
 * that is not an https page is ignored: the phone hands this to the OS, where
 * another scheme (`intent://`, a custom one) starts some other app.
 */
function storeUrlFor(
  fromApi: unknown,
  androidPackage: string | null | undefined,
): string | null {
  if (typeof fromApi === "string" && HTTPS_PAGE.test(fromApi.trim())) {
    return fromApi.trim();
  }

  if (typeof androidPackage === "string" && ANDROID_PACKAGE.test(androidPackage)) {
    return `https://play.google.com/store/apps/details?id=${androidPackage}`;
  }

  return null;
}

/**
 * Where the attempt is, for the screen to say.
 *
 * - `checking`, `downloading`: asking for and fetching an over-the-air update;
 * - `restarting`: applying it — the app reloads into the new bundle;
 * - `store`: the store page was opened;
 * - `no-store`: no store page could be opened; the screen says what to do.
 */
type UpgradeStep = "checking" | "downloading" | "restarting" | "store" | "no-store";

/** How an attempt ended. */
type UpgradeResult = Extract<UpgradeStep, "restarting" | "store" | "no-store">;

interface UpgradeDeps {
  /** `Updates.isEnabled`: false in development and in builds without OTA. */
  updatesEnabled: boolean;

  /** `Updates.checkForUpdateAsync`. */
  checkForUpdate: () => Promise<{ isAvailable: boolean }>;

  /** `Updates.fetchUpdateAsync`. */
  fetchUpdate: () => Promise<{ isNew: boolean }>;

  /** `Updates.reloadAsync`. */
  reload: () => Promise<void>;

  /** `Linking.openURL`. */
  openStore: (url: string) => Promise<unknown>;

  onStep?: (step: UpgradeStep) => void;

  /** How long asking for, or downloading, an update may take. */
  timeoutMs?: number;
}

// A driver staring at a blocking screen on a bad connection should reach the
// store button rather than a spinner that never ends.
const DEFAULT_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out")),
      timeoutMs,
    );

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Tries the over-the-air update for this runtime, then the store.
 *
 * An update exists for this runtime only when the fix needed no native code;
 * one that did is published as a new binary, and the only way to it is the
 * store. `isNew: false` after a download means the bundle already running is
 * the newest one — restarting into it would meet the same 426 — so that too
 * goes to the store. Every failure along the way falls through to the store
 * instead of leaving the driver on a spinner.
 *
 * Runs once per call and never calls itself: the screen starts it once on its
 * own and afterwards only when the driver taps the button.
 */
async function performUpgrade(
  storeUrl: string | null,
  deps: UpgradeDeps,
): Promise<UpgradeResult> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const report = (step: UpgradeStep) => deps.onStep?.(step);

  if (deps.updatesEnabled) {
    try {
      report("checking");
      const check = await withTimeout(deps.checkForUpdate(), timeoutMs);

      if (check.isAvailable) {
        report("downloading");
        const fetched = await withTimeout(deps.fetchUpdate(), timeoutMs);

        if (fetched.isNew) {
          report("restarting");
          await deps.reload();

          return "restarting";
        }
      }
    } catch {
      // Offline, a timeout, a refused reload: the store is still a way out.
    }
  }

  if (storeUrl) {
    try {
      await deps.openStore(storeUrl);
      report("store");

      return "store";
    } catch {
      // No app on the phone can open the page; the screen says what to do.
    }
  }

  report("no-store");

  return "no-store";
}

export {
  UPGRADE_REQUIRED_CODE,
  isUpgradeRequired,
  performUpgrade,
  storeUrlFor,
};
export type { UpgradeDeps, UpgradeResult, UpgradeStep };
