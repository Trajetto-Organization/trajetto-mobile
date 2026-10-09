import { Platform } from "react-native";

import Constants from "expo-constants";
import * as Updates from "expo-updates";

import { setClientVersion, type ClientVersion } from "./client-version";

/**
 * Describes this build to the API and the outbox, once, at boot.
 *
 * Imported for its side effect from `app/_layout.tsx`, next to the background
 * task, so it runs in the headless launch too: the tracking flush talks to
 * the API before any screen exists.
 *
 * Everything here is JavaScript-only (expo-constants and expo-updates are
 * already in every binary), so it reaches the phones in the field over the
 * air. Each value is best effort — a field the phone cannot tell is left out,
 * never guessed.
 */
function describeThisBuild(): ClientVersion {
  const nativeBuild =
    Platform.OS === "ios"
      ? Constants.platform?.ios?.buildNumber
      : Constants.platform?.android?.versionCode;

  return {
    platform: Platform.OS,
    version: Constants.expoConfig?.version ?? null,
    build: nativeBuild ?? null,
    runtime: Updates.runtimeVersion ?? null,
    update: Updates.updateId ?? "embedded",
  };
}

try {
  setClientVersion(describeThisBuild());
} catch {
  // Never worth failing a launch over: without it the app is simply not
  // described, which is exactly how every older build looks to the API.
}

export { describeThisBuild };
