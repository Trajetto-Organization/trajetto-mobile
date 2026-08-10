import AsyncStorage from "@react-native-async-storage/async-storage";

import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import type { ImagePickerAsset } from "expo-image-picker";
import {
  getSubmissionPersistenceEpoch,
  isSubmissionPersistenceActive,
} from "../submissions/submission-id";

interface FuelDraft<TFormData, TStepData> {
  submissionId: string;
  formData: Partial<TFormData>;
  stepData: Partial<TStepData>;
  odometerImage: ImagePickerAsset | null;
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
  new Directory(Paths.document, "trajetto-drafts", "fuel", submissionId);

export function persistFuelDraftImage(
  asset: ImagePickerAsset,
  submissionId: string,
): ImagePickerAsset {
  const directory = draftDirectory(submissionId);
  directory.create({ intermediates: true, idempotent: true });

  const source = new File(asset.uri);
  const destination = new File(directory, `odometer-${randomUUID()}.jpg`);

  source.copy(destination);

  try {
    if (source.exists && source.uri !== destination.uri) source.delete();
  } catch {
    // The optimized source lives in cache and may already have been evicted.
  }

  return {
    ...asset,
    uri: destination.uri,
    fileName: destination.name,
    fileSize: destination.size,
    mimeType: "image/jpeg",
  };
}

export function deleteFuelDraftImage(asset: ImagePickerAsset | null): void {
  if (!asset) return;
  try {
    const file = new File(asset.uri);
    if (file.exists && asset.uri.includes("/trajetto-drafts/fuel/")) {
      file.delete();
    }
  } catch {
    // Metadata cleanup remains safe when the file no longer exists.
  }
}

export async function saveFuelDraft<TFormData, TStepData>(
  submissionStorageKey: string,
  draft: FuelDraft<TFormData, TStepData>,
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

export async function loadFuelDraft<TFormData, TStepData>(
  submissionStorageKey: string,
): Promise<FuelDraft<TFormData, TStepData> | null> {
  return enqueueDraftMutation(submissionStorageKey, async () => {
    const rawDraft = await AsyncStorage.getItem(
      metadataKey(submissionStorageKey),
    );

    if (!rawDraft) return null;

    try {
      const draft = JSON.parse(rawDraft) as FuelDraft<TFormData, TStepData>;
      const odometerImage = draft.odometerImage;

      const hasImage = odometerImage
        ? (() => {
            try {
              return new File(odometerImage.uri).exists;
            } catch {
              return false;
            }
          })()
        : false;

      return {
        ...draft,
        odometerImage: hasImage ? odometerImage : null,
      };
    } catch {
      await AsyncStorage.removeItem(metadataKey(submissionStorageKey));
      return null;
    }
  });
}

export async function clearFuelDraft(
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
          idToDelete = (JSON.parse(rawDraft) as FuelDraft<unknown, unknown>)
            .submissionId;
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
      // AsyncStorage is authoritative; an orphan can be pruned later.
    }
  });
}
