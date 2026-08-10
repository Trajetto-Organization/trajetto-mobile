import AsyncStorage from "@react-native-async-storage/async-storage";

import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import type { ImagePickerAsset } from "expo-image-picker";
import {
  getSubmissionPersistenceEpoch,
  isSubmissionPersistenceActive,
} from "../submissions/submission-id";

interface ChecklistDraft<TFormData, TStepData> {
  submissionId: string;
  formData: Partial<TFormData>;
  stepData: Partial<TStepData>;
  images: Record<string, ImagePickerAsset[]>;
  updatedAt: string;
}

const metadataKey = (submissionStorageKey: string) =>
  `${submissionStorageKey}:draft`;
const draftMutationQueues = new Map<string, Promise<void>>();

const throwPersistenceAbort = (): never => {
  const error = new Error("Draft persistence is disabled");
  error.name = "AbortError";
  throw error;
};

const enqueueDraftMutation = async <T>(
  submissionStorageKey: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous =
    draftMutationQueues.get(submissionStorageKey) ?? Promise.resolve();

  const result = previous.then(operation, operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );

  draftMutationQueues.set(submissionStorageKey, settled);
  await result.finally(() => {
    if (draftMutationQueues.get(submissionStorageKey) === settled) {
      draftMutationQueues.delete(submissionStorageKey);
    }
  });

  return result;
};

const draftDirectory = (submissionId: string) =>
  new Directory(Paths.document, "trajetto-drafts", "checklist", submissionId);

export function persistChecklistDraftImage(
  asset: ImagePickerAsset,
  submissionId: string,
  fieldName: string,
): ImagePickerAsset {
  const directory = draftDirectory(submissionId);
  directory.create({ intermediates: true, idempotent: true });

  const source = new File(asset.uri);
  const destination = new File(directory, `${fieldName}-${randomUUID()}.jpg`);

  source.copy(destination);

  try {
    if (source.exists && source.uri !== destination.uri) source.delete();
  } catch {
    // The cache is disposable; failure to delete it must not lose the draft.
  }

  return {
    ...asset,
    uri: destination.uri,
    fileName: destination.name,
    fileSize: destination.size,
    mimeType: "image/jpeg",
  };
}

export function deleteChecklistDraftImage(asset: ImagePickerAsset): void {
  try {
    const file = new File(asset.uri);
    if (file.exists && asset.uri.includes("/trajetto-drafts/checklist/")) {
      file.delete();
    }
  } catch {
    // Metadata cleanup still proceeds if Android already removed the file.
  }
}

export async function saveChecklistDraft<TFormData, TStepData>(
  submissionStorageKey: string,
  draft: ChecklistDraft<TFormData, TStepData>,
): Promise<void> {
  const persistenceEpoch = getSubmissionPersistenceEpoch();
  await enqueueDraftMutation(submissionStorageKey, () =>
    (async () => {
      if (!isSubmissionPersistenceActive(persistenceEpoch)) {
        throwPersistenceAbort();
      }
      await AsyncStorage.setItem(
        metadataKey(submissionStorageKey),
        JSON.stringify(draft),
      );
      if (!isSubmissionPersistenceActive(persistenceEpoch)) {
        await AsyncStorage.removeItem(metadataKey(submissionStorageKey));
        throwPersistenceAbort();
      }
    })(),
  );
}

export async function loadChecklistDraft<TFormData, TStepData>(
  submissionStorageKey: string,
): Promise<ChecklistDraft<TFormData, TStepData> | null> {
  return enqueueDraftMutation(submissionStorageKey, async () => {
    const rawDraft = await AsyncStorage.getItem(
      metadataKey(submissionStorageKey),
    );
    if (!rawDraft) return null;

    try {
      const draft = JSON.parse(rawDraft) as ChecklistDraft<
        TFormData,
        TStepData
      >;
      const images = Object.fromEntries(
        Object.entries(draft.images || {}).map(([fieldName, assets]) => [
          fieldName,
          assets.filter((asset) => {
            try {
              return new File(asset.uri).exists;
            } catch {
              return false;
            }
          }),
        ]),
      );

      return { ...draft, images };
    } catch {
      await AsyncStorage.removeItem(metadataKey(submissionStorageKey));
      return null;
    }
  });
}

export async function clearChecklistDraft(
  submissionStorageKey: string,
  submissionId?: string,
): Promise<void> {
  await enqueueDraftMutation(submissionStorageKey, async () => {
    let idToDelete = submissionId;

    if (!idToDelete) {
      const rawDraft = await AsyncStorage.getItem(
        metadataKey(submissionStorageKey),
      );
      if (rawDraft) {
        try {
          idToDelete = (
            JSON.parse(rawDraft) as ChecklistDraft<unknown, unknown>
          ).submissionId;
        } catch {
          // Corrupt metadata is still removed below.
        }
      }
    }

    await AsyncStorage.removeItem(metadataKey(submissionStorageKey));
    if (!idToDelete) return;

    try {
      const directory = draftDirectory(idToDelete);
      if (directory.exists) directory.delete();
    } catch {
      // AsyncStorage is authoritative; orphan cleanup can happen on a later run.
    }
  });
}
