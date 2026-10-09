import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where a photo may come from (DLVP-PROOF-2, decision 6.9).
 *
 * The proof screen offered the gallery and the cropper: an old picture, or
 * one from another delivery, passed as today's stub, and the crop could cut
 * the part that did not match. The proof is now camera-only and uncropped;
 * occurrences and the fleet forms keep what they had.
 *
 * The capture hook runs for real (outside React, callbacks as plain
 * functions) against a stubbed picker.
 */

vi.mock("react", () => ({ useCallback: <T,>(fn: T) => fn }));

const toasts: Array<{ text1: string; text2?: string }> = [];

vi.mock("react-native-toast-message", () => ({
  default: { show: (toast: { text1: string; text2?: string }) => toasts.push(toast) },
}));

const local = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => local.get(key) ?? null,
    setItem: async (key: string, value: string) => void local.set(key, value),
    removeItem: async (key: string) => void local.delete(key),
  },
}));

const asset = {
  uri: "file:///cache/ImagePicker/shot.jpg",
  width: 1200,
  height: 900,
  fileName: "shot.jpg",
  fileSize: 2048,
  mimeType: "image/jpeg",
};

const picker = {
  camera: vi.fn(async (_options: Record<string, unknown>) => ({
    canceled: false,
    assets: [asset],
  })),
  library: vi.fn(async (_options: Record<string, unknown>) => ({
    canceled: false,
    assets: [asset],
  })),
  markerWhileCameraOpen: null as string | null,
};

vi.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchCameraAsync: async (options: Record<string, unknown>) => {
    picker.markerWhileCameraOpen =
      local.get("@trajetto:submission:pending-capture") ?? null;

    return picker.camera(options);
  },
  launchImageLibraryAsync: (options: Record<string, unknown>) =>
    picker.library(options),
  getPendingResultAsync: async () => null,
}));

// Re-encoding is native; what is proven here is the source, not the bytes.
vi.mock("@/features/media/prepare-image", () => ({
  prepareUploadImage: async (picked: typeof asset) => picked,
  getImageValidationError: () => null,
}));

let useImageCapture: typeof import("@/features/media/use-image-capture").useImageCapture;

beforeAll(async () => {
  ({ useImageCapture } = await import("@/features/media/use-image-capture"));
});

beforeEach(() => {
  toasts.length = 0;
  local.clear();
  picker.camera.mockClear();
  picker.library.mockClear();
  picker.markerWhileCameraOpen = null;
});

describe("the proof of delivery", () => {
  it("never opens the gallery", async () => {
    const onCapture = vi.fn();

    await useImageCapture({ onCapture, purpose: "delivery-proof" }).pickFromGallery();

    expect(picker.library).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
    expect(toasts.at(-1)?.text2).toBe(
      "O comprovante precisa ser fotografado na hora, com a câmera.",
    );
  });

  it("opens the camera without the cropper", async () => {
    const onCapture = vi.fn();

    await useImageCapture({ onCapture, purpose: "delivery-proof" }).takePhoto();

    expect(picker.camera).toHaveBeenCalledTimes(1);
    expect(picker.camera.mock.calls[0][0]).toMatchObject({ allowsEditing: false });
    expect(picker.camera.mock.calls[0][0]).not.toHaveProperty("aspect");
    expect(onCapture).toHaveBeenCalledWith(asset);
  });

  it("leaves a marker while the camera is open, and none once it answered", async () => {
    const marker = {
      ownerId: "driver-a",
      target: { kind: "delivery-proof", businessId: "b-1", deliveryId: "d-1" },
    };

    await useImageCapture({
      onCapture: vi.fn(),
      purpose: "delivery-proof",
      pendingCapture: marker,
    }).takePhoto();

    // While Android may kill the app, the marker says who asked for what.
    expect(JSON.parse(picker.markerWhileCameraOpen ?? "null")).toEqual(marker);

    // The camera answered in this process: nothing is left to recover.
    expect(local.has("@trajetto:submission:pending-capture")).toBe(false);
  });
});

describe("everything else keeps what it had", () => {
  it("an occurrence may still come from the gallery", async () => {
    const onCapture = vi.fn();

    await useImageCapture({
      onCapture,
      purpose: "delivery-occurrence",
    }).pickFromGallery();

    expect(picker.library).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith(asset);
  });

  it("the fleet forms keep the gallery and the 4:3 crop", async () => {
    const capture = useImageCapture({ onCapture: vi.fn() });

    await capture.takePhoto();
    await capture.pickFromGallery();

    expect(picker.camera.mock.calls[0][0]).toMatchObject({
      allowsEditing: true,
      aspect: [4, 3],
    });
    expect(picker.library).toHaveBeenCalledTimes(1);
  });
});
