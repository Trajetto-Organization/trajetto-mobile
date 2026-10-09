import { useCallback } from "react";

import * as ImagePicker from "expo-image-picker";
import Toast from "react-native-toast-message";

import {
  CAMERA_ONLY_MESSAGE,
  capturePolicy,
  pickerOptionsFor,
  type CapturePurpose,
} from "./capture-policy";
import {
  clearPendingCapture,
  markPendingCapture,
  takePendingCapture,
  type PendingCaptureMarker,
} from "./pending-capture";
import { getImageValidationError, prepareUploadImage } from "./prepare-image";

type OnCapture = (asset: ImagePicker.ImagePickerAsset) => void | Promise<void>;

interface UseImageCaptureInput {
  /**
   * Receives an image that has already been transcoded and checked. Anything
   * this rejects has been dealt with here, so the caller only ever sees a photo
   * that is safe to keep.
   */
  onCapture: OnCapture;

  /** Decides whether the gallery and the cropper are offered (`capture-policy`). */
  purpose?: CapturePurpose;

  /**
   * Written before the camera opens, so a photo taken while Android killed
   * the app can be routed back on the next launch (`pending-capture`).
   */
  pendingCapture?: PendingCaptureMarker | null;
}

interface ImageCapture {
  takePhoto: () => Promise<void>;
  pickFromGallery: () => Promise<void>;
}

const optionsFor = (purpose: CapturePurpose): ImagePicker.ImagePickerOptions => ({
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  ...pickerOptionsFor(capturePolicy(purpose)),
});

/**
 * Transcodes and checks a picked image; null when it cannot be kept.
 *
 * Preparation is deliberately here rather than left to each caller.
 * `prepareUploadImage` re-encodes the image, and re-encoding is the **only**
 * thing that strips EXIF now that the API no longer touches the bytes — a
 * screen that picked an image and skipped it would ship the driver's GPS
 * coordinates to the bucket.
 */
async function preparedOrNull(
  selected: ImagePicker.ImagePickerAsset,
): Promise<ImagePicker.ImagePickerAsset | null> {
  const asset = await prepareUploadImage(selected);
  const validationError = getImageValidationError(asset);

  if (validationError) {
    Toast.show({
      type: "error",
      text1: "Arquivo muito grande",
      text2: validationError,
      position: "top",
      visibilityTime: 4000,
    });

    return null;
  }

  return asset;
}

/** Opens the camera for `purpose` and hands a prepared photo to `onCapture`. */
async function captureWithCamera({
  purpose,
  pendingCapture,
  onCapture,
}: {
  purpose: CapturePurpose;
  pendingCapture?: PendingCaptureMarker | null;
  onCapture: OnCapture;
}): Promise<void> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();

  if (!permission.granted) {
    Toast.show({
      type: "error",
      text1: "Permissão necessária",
      text2: "É necessário permitir acesso à câmera.",
      position: "top",
    });

    return;
  }

  if (pendingCapture) {
    await markPendingCapture(pendingCapture).catch(() => undefined);
  }

  let result: ImagePicker.ImagePickerResult;

  try {
    result = await ImagePicker.launchCameraAsync(optionsFor(purpose));
  } finally {
    // The camera answered in this process: nothing is left to recover.
    if (pendingCapture) await clearPendingCapture().catch(() => undefined);
  }

  if (result.canceled || !result.assets[0]) return;

  const asset = await preparedOrNull(result.assets[0]);

  if (asset) await onCapture(asset);
}

/** Opens the gallery — only where the purpose allows one. */
async function captureFromGallery({
  purpose,
  onCapture,
}: {
  purpose: CapturePurpose;
  onCapture: OnCapture;
}): Promise<void> {
  if (!capturePolicy(purpose).gallery) {
    // The screens do not offer it; this is the guard behind them.
    Toast.show({
      type: "error",
      text1: "Use a câmera",
      text2: CAMERA_ONLY_MESSAGE,
      position: "top",
    });

    return;
  }

  // No permission request: the system photo picker needs none, and asking for
  // the media library on Android 12 or older would be refused outright, since
  // the manifest no longer declares READ_EXTERNAL_STORAGE (app.config.js).
  const result = await ImagePicker.launchImageLibraryAsync(optionsFor(purpose));
  if (result.canceled || !result.assets[0]) return;

  const asset = await preparedOrNull(result.assets[0]);

  if (asset) await onCapture(asset);
}

/**
 * A photo the camera took while the app was being killed, prepared like any
 * other, with the target it was taken for. Null when there is none.
 */
async function recoverPendingCapture<TTarget>(
  ownerId: string,
): Promise<{ target: TTarget; asset: ImagePicker.ImagePickerAsset } | null> {
  const pending = await takePendingCapture<TTarget>(ownerId);

  if (!pending) return null;

  const asset = await preparedOrNull(pending.asset);

  return asset ? { target: pending.target, asset } : null;
}

/** Gets a photo from the camera or, where allowed, the gallery. */
function useImageCapture({
  onCapture,
  purpose = "general",
  pendingCapture = null,
}: UseImageCaptureInput): ImageCapture {
  const takePhoto = useCallback(
    () => captureWithCamera({ purpose, pendingCapture, onCapture }),
    [purpose, pendingCapture, onCapture],
  );

  const pickFromGallery = useCallback(
    () => captureFromGallery({ purpose, onCapture }),
    [purpose, onCapture],
  );

  return { takePhoto, pickFromGallery };
}

export {
  captureFromGallery,
  captureWithCamera,
  recoverPendingCapture,
  useImageCapture,
};
export type { ImageCapture, UseImageCaptureInput };
