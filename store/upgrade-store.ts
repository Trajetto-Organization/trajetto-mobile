import { create } from "zustand";

/**
 * What the API said when it turned this build away (GAP5-2).
 *
 * `storeUrl` is the API's MOBILE_STORE_URL as it came, or null; the screen
 * checks it before opening anything (`storeUrlFor`).
 */
interface UpgradeNotice {
  storeUrl: string | null;
}

interface UpgradeState {
  /** Set by the first 426 CLIENT_UPGRADE_REQUIRED; the screen shows while set. */
  notice: UpgradeNotice | null;

  /** Whether this launch already tried to update on its own. */
  automaticAttempted: boolean;
}

/**
 * Whether this build has been turned away, for the blocking update screen.
 *
 * Set from outside React, like the connection store, because the knowledge
 * is in `apiClient`: any request can meet the gate. Never cleared — nothing
 * but a new bundle (which starts a fresh process) makes this build welcome
 * again.
 */
const useUpgradeStore = create<UpgradeState>(() => ({
  notice: null,
  automaticAttempted: false,
}));

/**
 * Called by `apiClient` on a 426 CLIENT_UPGRADE_REQUIRED.
 *
 * Only the first one counts. While the screen is up the outbox and the lists
 * keep asking and keep meeting the gate; letting each answer set the state
 * again would re-render the screen on every one of them, and a later answer
 * must not swap the store page under a driver who is about to tap it.
 */
function reportUpgradeRequired(notice: UpgradeNotice): void {
  if (useUpgradeStore.getState().notice) return;

  useUpgradeStore.setState({ notice });
}

/**
 * True the first time only: the screen updates on its own once per launch,
 * and after that only when the driver taps. An automatic attempt on every
 * mount would reopen the store each time the driver came back from it.
 *
 * And only with the app in front of the driver (`appState` is React Native's
 * AppState). The tracking flush meets the gate in the background too, while
 * the driver navigates in another app: restarting the app or opening the
 * store over that is not something to do behind their back, and the one
 * attempt spent where nobody sees it left them only the button on return.
 * Not claimed then, so it runs when the app comes to the front.
 */
function claimAutomaticUpgrade(appState: string): boolean {
  if (appState !== "active") return false;

  if (useUpgradeStore.getState().automaticAttempted) return false;

  useUpgradeStore.setState({ automaticAttempted: true });

  return true;
}

export { claimAutomaticUpgrade, reportUpgradeRequired, useUpgradeStore };
export type { UpgradeNotice };
