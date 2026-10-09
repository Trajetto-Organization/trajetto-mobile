import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";

/**
 * A photo the camera took while Android killed the app.
 *
 * On an entry-level phone the system often destroys the app while the camera
 * is open. The camera still returns its picture, but to an app that no
 * longer has the screen that asked for it — the stub photo was simply lost
 * (MOB-12). `ImagePicker.getPendingResultAsync` hands it back on the next
 * launch, once; this module remembers WHO asked for it and for WHAT, so the
 * photo lands in the right draft.
 *
 * The key carries the submission prefix on purpose: the logout's cleanup
 * removes every `@trajetto:submission:` key, so a marker never outlives the
 * session that wrote it.
 */
const PENDING_CAPTURE_KEY = "@trajetto:submission:pending-capture";

interface PendingCaptureMarker<TTarget = unknown> {
  /** The user whose screen opened the camera. */
  ownerId: string;

  /** Opaque to this module: what the caller needs to route the photo. */
  target: TTarget;
}

async function markPendingCapture(marker: PendingCaptureMarker): Promise<void> {
  await AsyncStorage.setItem(PENDING_CAPTURE_KEY, JSON.stringify(marker));
}

async function clearPendingCapture(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_CAPTURE_KEY);
}

/**
 * The picture and its target, when a marked capture was cut short.
 *
 * Asks the picker only when a marker exists: the pending result is handed
 * out once, and taking it for a capture this module did not start would
 * steal it from whoever did. A marker of another user is dropped with its
 * photo — it was never this session's to see.
 */
async function takePendingCapture<TTarget>(
  ownerId: string,
): Promise<{ target: TTarget; asset: ImagePicker.ImagePickerAsset } | null> {
  const raw = await AsyncStorage.getItem(PENDING_CAPTURE_KEY);

  if (!raw) return null;

  let marker: PendingCaptureMarker<TTarget> | null = null;

  try {
    marker = JSON.parse(raw) as PendingCaptureMarker<TTarget>;
  } catch {
    marker = null;
  }

  const result = await ImagePicker.getPendingResultAsync().catch(() => null);

  await clearPendingCapture();

  if (!marker || marker.ownerId !== ownerId) return null;
  if (!result || "code" in result || result.canceled) return null;

  const asset = result.assets?.[0];

  return asset ? { target: marker.target, asset } : null;
}

export {
  PENDING_CAPTURE_KEY,
  clearPendingCapture,
  markPendingCapture,
  takePendingCapture,
};

export type { PendingCaptureMarker };
