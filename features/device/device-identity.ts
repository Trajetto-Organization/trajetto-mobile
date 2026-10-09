import { chooseDeviceId } from "./device-identity-rules";

/**
 * The phone's identity printed on the proof PDF (proof design §8.1).
 *
 * The Android ID first: 16 hex characters, stable per app-signing key, user
 * and device. Otherwise an installation UUID created once and kept in the
 * secure store; it changes when the app is reinstalled, and the PDF prints
 * whatever it received. Not part of the session: a logout keeps it, because
 * it names the phone, not the driver.
 *
 * Memoized, and never throws: an identity that cannot be read sends no
 * `device_id`, and the proof goes out without it. The native modules load
 * on first use, so the delivery actions that import this stay loadable
 * where they are absent.
 */
const INSTALLATION_ID_KEY = "device-installation-id";

let pending: Promise<string | null> | null = null;

async function readAndroidId(): Promise<string | null> {
  try {
    const { Platform } = await import("react-native");
    if (Platform.OS !== "android") return null;

    const Application = await import("expo-application");

    return Application.getAndroidId();
  } catch {
    // A build without the native module: the installation id stands in.
    return null;
  }
}

async function installationId(): Promise<string | null> {
  try {
    const SecureStore = await import("expo-secure-store");

    const stored = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
    if (stored) return stored;

    const { randomUUID } = await import("expo-crypto");
    const created = randomUUID();
    await SecureStore.setItemAsync(INSTALLATION_ID_KEY, created);

    return created;
  } catch {
    return null;
  }
}

async function resolveIdentity(): Promise<string | null> {
  const android = chooseDeviceId(await readAndroidId(), null);
  if (android) return android;

  return chooseDeviceId(null, await installationId());
}

function deviceIdentity(): Promise<string | null> {
  if (!pending) {
    pending = resolveIdentity().catch(() => null);

    // A failed read is not remembered: the next proof tries again.
    void pending.then((value) => {
      if (value === null) pending = null;
    });
  }

  return pending;
}

/** Tests only. */
function resetDeviceIdentity(): void {
  pending = null;
}

export { INSTALLATION_ID_KEY, deviceIdentity, resetDeviceIdentity };
