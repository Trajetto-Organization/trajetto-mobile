import type { ImagePickerAsset } from "expo-image-picker";

import {
  clearDraft,
  deleteDraftImage,
  draftFileExists,
  loadDraft,
  persistDraftImage,
  saveDraft,
  type DraftEnvelope,
} from "@/features/submissions/draft-store";

/**
 * The refuelling's own draft shape. The storage mechanism lives in
 * `draft-store`; what belongs here is only the knowledge that a refuelling
 * carries exactly one photo, of the odometer.
 */
interface FuelDraft<TFormData, TStepData> extends DraftEnvelope {
  formData: Partial<TFormData>;
  stepData: Partial<TStepData>;
  odometerImage: ImagePickerAsset | null;

  /**
   * The phone's pre-check of that photo and km (decision 14.2), so it
   * survives the app dying. Bound to the photo it read: a new photo makes it
   * stale (features/ai-precheck `precheckApplies`). Absent on older drafts.
   */
  precheck?: unknown;

  updatedAt: string;
}

const KIND = "fuel" as const;

function persistFuelDraftImage(
  asset: ImagePickerAsset,
  submissionId: string,
): ImagePickerAsset {
  return persistDraftImage(KIND, asset, submissionId, "odometer");
}

function deleteFuelDraftImage(asset: ImagePickerAsset | null): void {
  if (!asset) return;
  deleteDraftImage(KIND, asset);
}

async function saveFuelDraft<TFormData, TStepData>(
  submissionStorageKey: string,
  draft: FuelDraft<TFormData, TStepData>,
): Promise<void> {
  await saveDraft(submissionStorageKey, draft);
}

async function loadFuelDraft<TFormData, TStepData>(
  submissionStorageKey: string,
): Promise<FuelDraft<TFormData, TStepData> | null> {
  return loadDraft<FuelDraft<TFormData, TStepData>>(
    submissionStorageKey,
    (draft) => ({
      ...draft,

      // The odometer photo is mandatory, so a missing file has to become an
      // explicit absence rather than a broken reference — the form then asks
      // for it again instead of failing at submit.
      odometerImage:
        draft.odometerImage && draftFileExists(draft.odometerImage.uri)
          ? draft.odometerImage
          : null,
    }),
  );
}

async function clearFuelDraft(
  submissionStorageKey: string,
  submissionId?: string,
): Promise<void> {
  await clearDraft(KIND, submissionStorageKey, submissionId);
}

export {
  clearFuelDraft,
  deleteFuelDraftImage,
  loadFuelDraft,
  persistFuelDraftImage,
  saveFuelDraft,
};

export type { FuelDraft };
