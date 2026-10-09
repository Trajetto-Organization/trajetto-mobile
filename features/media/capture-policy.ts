/**
 * Where a photo may come from, per purpose.
 *
 * Pure and import-free so the rule is readable by a test. The proof of
 * delivery is camera-only and uncropped (decision 6.9): the gallery let an
 * old picture — or one from another delivery — pass as today's receipt, and
 * the cropper let the driver cut the part of the stub that did not match
 * (DLVP-PROOF-2). Occurrences keep the gallery: a photo of the damage taken a
 * minute earlier with the camera app is still evidence.
 */

type CapturePurpose = "general" | "delivery-proof" | "delivery-occurrence";

interface CapturePolicy {
  /** Whether an existing picture may be chosen instead of taking one. */
  gallery: boolean;

  /** Whether the system cropper opens after the shot. */
  allowsEditing: boolean;
}

const CAPTURE_POLICIES: Record<CapturePurpose, CapturePolicy> = {
  // Odometer and checklist photos: as they always were.
  general: { gallery: true, allowsEditing: true },
  "delivery-occurrence": { gallery: true, allowsEditing: true },
  "delivery-proof": { gallery: false, allowsEditing: false },
};

/** What the driver reads when the gallery is not an option. */
const CAMERA_ONLY_MESSAGE =
  "O comprovante precisa ser fotografado na hora, com a câmera.";

function capturePolicy(purpose: CapturePurpose): CapturePolicy {
  return CAPTURE_POLICIES[purpose];
}

/** The picker options a policy translates to (media type added by the caller). */
function pickerOptionsFor(policy: CapturePolicy): {
  allowsEditing: boolean;
  aspect?: [number, number];
  quality: number;
} {
  return policy.allowsEditing
    ? { allowsEditing: true, aspect: [4, 3], quality: 0.8 }
    : { allowsEditing: false, quality: 0.8 };
}

export { CAMERA_ONLY_MESSAGE, capturePolicy, pickerOptionsFor };
export type { CapturePolicy, CapturePurpose };
