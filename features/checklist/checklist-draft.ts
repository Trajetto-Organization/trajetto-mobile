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
 * The checklist's own draft shape. The storage mechanism lives in
 * `draft-store`; what belongs here is only the knowledge that a checklist
 * carries photos grouped by the question they answer.
 */
interface ChecklistDraft<TFormData, TStepData> extends DraftEnvelope {
  formData: Partial<TFormData>;
  stepData: Partial<TStepData>;
  images: Record<string, ImagePickerAsset[]>;

  /**
   * The phone's pre-check of the odometer photo and km (decision 14.2),
   * bound to the photo it read. Absent on older drafts.
   */
  precheck?: unknown;

  updatedAt: string;
}

const KIND = "checklist" as const;

function persistChecklistDraftImage(
  asset: ImagePickerAsset,
  submissionId: string,
  fieldName: string,
): ImagePickerAsset {
  return persistDraftImage(KIND, asset, submissionId, fieldName);
}

function deleteChecklistDraftImage(asset: ImagePickerAsset): void {
  deleteDraftImage(KIND, asset);
}

async function saveChecklistDraft<TFormData, TStepData>(
  submissionStorageKey: string,
  draft: ChecklistDraft<TFormData, TStepData>,
): Promise<void> {
  await saveDraft(submissionStorageKey, draft);
}

async function loadChecklistDraft<TFormData, TStepData>(
  submissionStorageKey: string,
): Promise<ChecklistDraft<TFormData, TStepData> | null> {
  return loadDraft<ChecklistDraft<TFormData, TStepData>>(
    submissionStorageKey,
    (draft) => ({
      ...draft,

      // A photo whose file is gone would render as a broken slot and fail the
      // upload later; dropping it here puts the form back in a state the driver
      // can act on — the field simply asks for its photo again.
      images: Object.fromEntries(
        Object.entries(draft.images || {}).map(([fieldName, assets]) => [
          fieldName,
          assets.filter((asset) => draftFileExists(asset.uri)),
        ]),
      ),
    }),
  );
}

async function clearChecklistDraft(
  submissionStorageKey: string,
  submissionId?: string,
): Promise<void> {
  await clearDraft(KIND, submissionStorageKey, submissionId);
}

export {
  clearChecklistDraft,
  deleteChecklistDraftImage,
  loadChecklistDraft,
  persistChecklistDraftImage,
  saveChecklistDraft,
};

export type { ChecklistDraft };
