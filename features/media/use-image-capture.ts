import { useCallback } from "react";

import * as ImagePicker from "expo-image-picker";
import Toast from "react-native-toast-message";

import { getImageValidationError, prepareUploadImage } from "./prepare-image";

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  allowsEditing: true,
  aspect: [4, 3],
  quality: 0.8,
};

interface UseImageCaptureInput {
  /**
   * Receives an image that has already been transcoded and checked. Anything
   * this rejects has been dealt with here, so the caller only ever sees a photo
   * that is safe to keep.
   */
  onCapture: (asset: ImagePicker.ImagePickerAsset) => void | Promise<void>;
}

interface ImageCapture {
  takePhoto: () => Promise<void>;
  pickFromGallery: () => Promise<void>;
}

/**
 * Gets a photo from the camera or the gallery, ready to be stored.
 *
 * Preparation is deliberately inside this hook rather than left to each caller.
 * `prepareUploadImage` re-encodes the image, and re-encoding is the **only**
 * thing that strips EXIF now that the API no longer touches the bytes — a
 * screen that picked an image and skipped it would ship the driver's GPS
 * coordinates to the bucket. Making that unreachable is worth more than the
 * flexibility of letting a caller do its own thing.
 */
function useImageCapture({ onCapture }: UseImageCaptureInput): ImageCapture {
  const handleSelection = useCallback(
    async (selected: ImagePicker.ImagePickerAsset) => {
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

        return;
      }

      await onCapture(asset);
    },
    [onCapture],
  );

  const takePhoto = useCallback(async () => {
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

    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    if (result.canceled || !result.assets[0]) return;

    await handleSelection(result.assets[0]);
  }, [handleSelection]);

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Toast.show({
        type: "error",
        text1: "Permissão necessária",
        text2: "É necessário permitir acesso à galeria.",
        position: "top",
      });

      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (result.canceled || !result.assets[0]) return;

    await handleSelection(result.assets[0]);
  }, [handleSelection]);

  return { takePhoto, pickFromGallery };
}

export { useImageCapture };
export type { ImageCapture, UseImageCaptureInput };
