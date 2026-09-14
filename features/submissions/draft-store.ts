import AsyncStorage from "@react-native-async-storage/async-storage";

import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import type { ImagePickerAsset } from "expo-image-picker";

import {
  getSubmissionPersistenceEpoch,
  isSubmissionPersistenceActive,
} from "./submission-id";

/**
 * Where a half-filled form lives between app launches.
 *
 * The mechanism is identical for a checklist and a refuelling — same queueing,
 * same epoch checks, same directory lifecycle — so it lives here once. What
 * differs is only the *shape* of what gets stored, and that stays with each
 * feature: this module never looks inside the draft. Making it look would mean
 * renaming persisted fields, which is how a driver mid-inspection loses their
 * work to an app update.
 */

type DraftKind = "checklist" | "fuel";

const DRAFT_ROOT = "trajetto-drafts";

/** Anything persisted has to name the submission it belongs to. */
interface DraftEnvelope {
  submissionId: string;
}

const metadataKey = (submissionStorageKey: string) =>
  `${submissionStorageKey}:draft`;

const draftDirectory = (kind: DraftKind, submissionId: string) =>
  new Directory(Paths.document, DRAFT_ROOT, kind, submissionId);

// Serialised per form. Two writes racing on the same key is how a draft ends up
// half-written, and the autosave fires on every keystroke.
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

/** Whether a file a draft points at is still on disk. */
function draftFileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * Moves a picked image into storage that survives the app being killed.
 *
 * The picker leaves images in the cache directory, which the OS is free to
 * evict. A draft pointing at an evicted file is a draft that silently loses its
 * photos, so it is copied under the submission's own directory and the cache
 * copy is dropped.
 */
function persistDraftImage(
  kind: DraftKind,
  asset: ImagePickerAsset,
  submissionId: string,
  label: string,
): ImagePickerAsset {
  const directory = draftDirectory(kind, submissionId);
  directory.create({ intermediates: true, idempotent: true });

  const source = new File(asset.uri);
  const destination = new File(directory, `${label}-${randomUUID()}.jpg`);

  source.copy(destination);

  try {
    if (source.exists && source.uri !== destination.uri) source.delete();
  } catch {
    // The cache is disposable and may already have been evicted; failing to
    // tidy it must not cost the draft.
  }

  return {
    ...asset,
    uri: destination.uri,
    fileName: destination.name,
    fileSize: destination.size,
    mimeType: "image/jpeg",
  };
}

/** Removes one image, but only if it is really one of ours. */
function deleteDraftImage(kind: DraftKind, asset: ImagePickerAsset): void {
  try {
    const file = new File(asset.uri);
    if (file.exists && asset.uri.includes(`/${DRAFT_ROOT}/${kind}/`)) {
      file.delete();
    }
  } catch {
    // Metadata cleanup still proceeds if the platform already removed the file.
  }
}

/**
 * Writes the draft, and un-writes it if the session ended mid-write.
 *
 * The epoch is checked on both sides of the write because a logout can land
 * between them, and a draft that outlives its session is another user's data
 * sitting on the device.
 */
async function saveDraft<TDraft extends DraftEnvelope>(
  submissionStorageKey: string,
  draft: TDraft,
): Promise<void> {
  const persistenceEpoch = getSubmissionPersistenceEpoch();

  await enqueueDraftMutation(submissionStorageKey, async () => {
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
  });
}

/**
 * Reads the draft back, letting the caller repair its own media references.
 *
 * `revive` exists because only the feature knows where images sit in its
 * payload, and files can vanish between launches — the metadata is the record,
 * the filesystem is the truth.
 */
async function loadDraft<TDraft extends DraftEnvelope>(
  submissionStorageKey: string,
  revive?: (draft: TDraft) => TDraft,
): Promise<TDraft | null> {
  return enqueueDraftMutation(submissionStorageKey, async () => {
    const rawDraft = await AsyncStorage.getItem(
      metadataKey(submissionStorageKey),
    );

    if (!rawDraft) return null;

    try {
      const draft = JSON.parse(rawDraft) as TDraft;
      return revive ? revive(draft) : draft;
    } catch {
      await AsyncStorage.removeItem(metadataKey(submissionStorageKey));
      return null;
    }
  });
}

/** Drops the draft and the photo directory that belongs to it. */
async function clearDraft(
  kind: DraftKind,
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
          idToDelete = (JSON.parse(rawDraft) as DraftEnvelope).submissionId;
        } catch {
          // Corrupt metadata is still removed below.
        }
      }
    }

    await AsyncStorage.removeItem(metadataKey(submissionStorageKey));
    if (!idToDelete) return;

    try {
      const directory = draftDirectory(kind, idToDelete);
      if (directory.exists) directory.delete();
    } catch {
      // AsyncStorage is authoritative; an orphan directory can be pruned later.
    }
  });
}

export {
  clearDraft,
  deleteDraftImage,
  draftFileExists,
  loadDraft,
  persistDraftImage,
  saveDraft,
};

export type { DraftEnvelope, DraftKind };
