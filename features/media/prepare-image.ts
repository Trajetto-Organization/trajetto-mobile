import { File } from "expo-file-system";
import {
  manipulateAsync,
  SaveFormat,
  type Action,
} from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";

export const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_CHECKLIST_IMAGES = 20;
export const MAX_CHECKLIST_UPLOAD_BYTES = 5 * 1024 * 1024;

const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.72;

/**
 * Normalizes camera/gallery output before it reaches component state.
 * The backend accepts JPEG and limits each multipart file to 5 MB, so every
 * selected image gets a bounded dimension, predictable MIME type and real
 * post-transcode byte size.
 */
export async function prepareUploadImage(
  asset: ImagePickerAsset,
): Promise<ImagePickerAsset> {
  const largestDimension = Math.max(asset.width, asset.height);
  const actions: Action[] = [];

  if (largestDimension > MAX_IMAGE_DIMENSION) {
    actions.push({
      resize:
        asset.width >= asset.height
          ? { width: MAX_IMAGE_DIMENSION }
          : { height: MAX_IMAGE_DIMENSION },
    });
  }

  const result = await manipulateAsync(asset.uri, actions, {
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  const file = new File(result.uri);
  const baseName = (asset.fileName || "photo").replace(/\.[^.]+$/, "");

  return {
    ...asset,
    uri: result.uri,
    width: result.width,
    height: result.height,
    fileName: `${baseName}.jpg`,
    fileSize: file.size ?? undefined,
    mimeType: "image/jpeg",
  };
}

export function getImageValidationError(
  asset: ImagePickerAsset,
): string | null {
  if (!asset.fileSize) {
    return "Não foi possível determinar o tamanho final da imagem.";
  }

  if (asset.fileSize > MAX_UPLOAD_IMAGE_BYTES) {
    return "A imagem otimizada ainda excede o limite de 5 MB.";
  }

  return null;
}

export function createImageFormDataPart(
  asset: ImagePickerAsset,
  fallbackName: string,
) {
  return {
    uri: asset.uri,
    type: asset.mimeType || "image/jpeg",
    name: asset.fileName || `${fallbackName}.jpg`,
  } as any;
}
