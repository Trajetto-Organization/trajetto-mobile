import AsyncStorage from "@react-native-async-storage/async-storage";

import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import {
  draftFileExists,
  loadDraft,
  saveDraft,
} from "@/features/submissions/draft-store";
import {
  clearSubmissionId,
  getOrCreateSubmissionId,
  getSubmissionPersistenceEpoch,
  isSubmissionPersistenceActive,
} from "@/features/submissions/submission-id";

import { recoverPendingCapture } from "@/features/media/use-image-capture";

import {
  deliveryDraftKey,
  reviveOccurrenceDraft,
  reviveProofDraft,
  withRecoveredPhoto,
  type DeliveryCaptureTarget,
  type DeliveryDraftKind,
  type DraftFile,
  type OccurrenceDraft,
  type ProofDraft,
} from "./delivery-draft-rules";

/**
 * Proof and occurrence drafts on disk (MOB-12).
 *
 * The photo of the stub, the signature and "Quem recebeu" lived only in React
 * state: the app killed while the camera was open, or by a call, took them
 * all. Fuel and checklist already kept durable drafts; these now do too, on
 * the same storage (`draft-store`'s save and load, the same key shape, the
 * same `trajetto-drafts/<kind>/<submissionId>` directory), so the logout's
 * cleanup, its warning and the send-time hold treat them the same way.
 *
 * The files are copied here rather than through `draft-store`'s image
 * helpers because those are typed to the fleet kinds; see the package notes.
 */

const DRAFT_ROOT = "trajetto-drafts";

const draftDirectory = (kind: DeliveryDraftKind, submissionId: string) =>
  new Directory(Paths.document, DRAFT_ROOT, kind, submissionId);

const extensionOf = (file: DraftFile): string => {
  if (file.mimeType === "image/png") return "png";

  const fromName = file.fileName?.match(/\.([a-z0-9]+)$/i)?.[1];

  return fromName?.toLowerCase() ?? "jpg";
};

/**
 * Moves a picked or drawn file into storage that survives the app being
 * killed. The picker and the signature pad leave theirs in the cache, which
 * the OS is free to evict.
 */
function persistDeliveryDraftFile(
  kind: DeliveryDraftKind,
  file: DraftFile,
  submissionId: string,
  label: string,
): DraftFile {
  const directory = draftDirectory(kind, submissionId);
  directory.create({ intermediates: true, idempotent: true });

  const source = new File(file.uri);

  // Already ours (a draft restored and saved again): nothing to move.
  if (source.uri.startsWith(directory.uri)) return file;

  const destination = new File(
    directory,
    `${label}-${randomUUID()}.${extensionOf(file)}`,
  );

  source.copy(destination);

  try {
    if (source.exists) source.delete();
  } catch {
    // The cache is disposable; failing to tidy it must not cost the draft.
  }

  return {
    uri: destination.uri,
    fileName: destination.name,
    fileSize: destination.size ?? file.fileSize,
    mimeType: file.mimeType ?? "image/jpeg",
    // The capture's instant travels with the file into the draft.
    ...(file.takenAt && { takenAt: file.takenAt }),
  };
}

/** Removes a file the draft no longer points at, if it is one of ours. */
function deleteDeliveryDraftFile(
  kind: DeliveryDraftKind,
  file: DraftFile | null,
): void {
  if (!file || !file.uri.includes(`/${DRAFT_ROOT}/${kind}/`)) return;

  try {
    const stored = new File(file.uri);
    if (stored.exists) stored.delete();
  } catch {
    // The directory goes with the draft anyway.
  }
}

async function saveProofDraft(key: string, draft: ProofDraft): Promise<void> {
  await saveDraft(key, draft);
}

async function saveOccurrenceDraft(
  key: string,
  draft: OccurrenceDraft,
): Promise<void> {
  await saveDraft(key, draft);
}

async function loadProofDraft(key: string): Promise<ProofDraft | null> {
  const stored = await loadDraft<ProofDraft>(key);

  return stored ? reviveProofDraft(stored, draftFileExists) : null;
}

async function loadOccurrenceDraft(key: string): Promise<OccurrenceDraft | null> {
  const stored = await loadDraft<OccurrenceDraft>(key);

  return stored ? reviveOccurrenceDraft(stored, draftFileExists) : null;
}

/**
 * Drops the draft, its files and its submission id, once the work has been
 * handed off (sent, or queued with the queue's own copy of the files).
 *
 * `loadDraft` first, for its ordering and not its value: saves run on a
 * per-key queue in `draft-store`, and reading through that queue waits for a
 * save already under way — one landing after the removal would bring back a
 * proof the driver already sent.
 */
async function clearDeliveryDraft(
  kind: DeliveryDraftKind,
  key: string,
  submissionId: string,
): Promise<void> {
  await loadDraft(key).catch(() => null);
  await AsyncStorage.removeItem(`${key}:draft`);

  try {
    const directory = draftDirectory(kind, submissionId);
    if (directory.exists) directory.delete();
  } catch {
    // AsyncStorage is authoritative; an orphan directory goes at logout.
  }

  await clearSubmissionId(key);
}

/**
 * Puts a photo the camera took while the app was being killed into the
 * draft it was taken for. Returns that target, or null when there was none.
 *
 * Waits for the session's persistence to be open: before it, the draft
 * could not be written, and the picker's pending result is handed out once.
 */
async function recoverDeliveryCapture(
  userId: string,
): Promise<DeliveryCaptureTarget | null> {
  if (!isSubmissionPersistenceActive(getSubmissionPersistenceEpoch())) {
    return null;
  }

  const recovered = await recoverPendingCapture<DeliveryCaptureTarget>(userId);

  if (!recovered) return null;

  const { target, asset } = recovered;

  const key = deliveryDraftKey(
    target.kind,
    userId,
    target.businessId,
    target.deliveryId,
  );

  const submissionId = await getOrCreateSubmissionId(key);

  const photo = persistDeliveryDraftFile(
    target.kind,
    {
      uri: asset.uri,
      fileName: asset.fileName,
      fileSize: asset.fileSize,
      mimeType: asset.mimeType,
    },
    submissionId,
    "photo",
  );

  const existing =
    target.kind === "delivery-proof"
      ? await loadProofDraft(key)
      : await loadOccurrenceDraft(key);

  await saveDraft(
    key,
    withRecoveredPhoto(
      target.kind,
      existing,
      submissionId,
      photo,
      new Date().toISOString(),
    ),
  );

  return target;
}

export {
  clearDeliveryDraft,
  deleteDeliveryDraftFile,
  loadOccurrenceDraft,
  loadProofDraft,
  persistDeliveryDraftFile,
  recoverDeliveryCapture,
  saveOccurrenceDraft,
  saveProofDraft,
};
