import { FileSystemUploadType, uploadAsync } from "expo-file-system/legacy";

import { apiClient } from "@/utils/api";
import { hostOf } from "@/features/diagnostics/client-report-rules";

export type UploadType =
  | "checklistPhotos"
  | "odometerPhotos"
  | "avatars"
  | "deliveryPhotos"
  | "chatAttachments";

/**
 * The minimum an image has to carry to be uploadable.
 *
 * Narrower than `ImagePickerAsset` on purpose: photos are also reloaded from
 * disk long after the picker is gone, where all that survives is what was
 * written down.
 */
export interface UploadFile {
  uri: string;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string | null;

  /**
   * When the camera returned it (proof design §8.2), for the receipt's
   * `photo_taken_at`. Kept with the draft; absent on a picked file or a
   * capture recovered after the app was killed.
   */
  takenAt?: string;
}

export interface UploadEntry {
  file: UploadFile;

  // Which checklist question the photo answers. Carried through untouched so
  // the caller gets its keys back already labelled.
  fieldName?: string;

  // A key from an earlier attempt that already reached storage. The file behind
  // it is not sent again — a driver on a connection that drops should not
  // restart twenty photos because the last one failed.
  uploadedKey?: string;
}

export interface UploadedPhoto {
  key: string;
  fieldName?: string;
}

interface PresignedUpload {
  key: string;
  uploadUrl: string;
  expiresIn: number;
}

interface UploadToStorageOptions {
  entries: UploadEntry[];
  uploadType: UploadType;
  businessId: string;
  signal?: AbortSignal;

  // Called after each file lands, so a form can show real progress instead of
  // an indeterminate spinner.
  onProgress?: (uploaded: number, total: number) => void;

  // Called with the position of each file as it lands, so a caller that
  // persists state can record the key immediately.
  onUploaded?: (index: number, key: string) => void;
}

export class UploadError extends Error {
  /**
   * The HTTP status of the refused PUT, and the storage host it went to —
   * never the signed URL (OBS-12). What tells a phone without signal from a
   * bucket that refuses the signature (403): the message the driver reads is
   * the same for both.
   */
  readonly status?: number;
  readonly host?: string;

  constructor(message: string, details: { status?: number; host?: string } = {}) {
    super(message);
    this.name = "UploadError";
    this.status = details.status;
    this.host = details.host;
  }
}

/**
 * The driver stopped the upload: discarded the form, changed step, left.
 *
 * Named `AbortError` like every other cancellation in the app, NOT an
 * `UploadError`. The queue reads an `UploadError` as the connection failing,
 * which it is worth retrying — so a checklist the driver threw away used to be
 * queued with a copy of its photos and sent on the next sweep.
 */
function createUploadAbortError(): Error {
  const error = new Error("Envio cancelado.");
  error.name = "AbortError";

  return error;
}

// Enough to keep a mobile connection busy without opening twenty sockets at
// once, which on 3G makes every single upload slower.
const CONCURRENCY = 3;

/**
 * Uploads photos straight from the device to storage and returns their keys.
 *
 * The bytes never pass through the API. It only signs: one round trip declares
 * every file, then each PUT goes to the bucket directly. That matters most on
 * mobile, where a checklist carries up to twenty camera photos — sending them
 * in one request meant a single connection holding all of them, which any
 * tunnel change could drop halfway through.
 *
 * `uploadAsync` with BINARY_CONTENT streams the file from disk, so a 5 MB photo
 * never becomes a 5 MB JavaScript string on its way out.
 */
export async function uploadToStorage({
  entries,
  uploadType,
  businessId,
  signal,
  onProgress,
  onUploaded,
}: UploadToStorageOptions): Promise<UploadedPhoto[]> {
  if (entries.length === 0) return [];

  const uploaded: UploadedPhoto[] = new Array(entries.length);

  // Anything already in storage is a result, not work. Recorded first so the
  // positions still line up with what the caller passed in.
  const pending: { entry: UploadEntry; index: number }[] = [];

  entries.forEach((entry, index) => {
    if (entry.uploadedKey) {
      uploaded[index] = { key: entry.uploadedKey, fieldName: entry.fieldName };
      return;
    }

    pending.push({ entry, index });
  });

  let completed = entries.length - pending.length;
  onProgress?.(completed, entries.length);

  if (pending.length === 0) return uploaded;

  const endpoint =
    uploadType === "avatars"
      ? "/uploads/avatar/presign"
      : `/uploads/presign/${businessId}`;

  const files = pending.map(({ entry }) => describeFile(entry.file));
  const body = uploadType === "avatars" ? { files } : { uploadType, files };

  if (signal?.aborted) throw createUploadAbortError();

  // The signal goes with the presign too: leaving the screen while it is in
  // flight must surface as the abort it is, not as whatever comes after.
  const { uploads } = await apiClient.request<{ uploads: PresignedUpload[] }>(
    endpoint,
    { method: "POST", body, signal },
  );

  if (!uploads || uploads.length !== pending.length) {
    throw new UploadError("Não foi possível autorizar o envio das fotos.");
  }

  // A shared cursor rather than fixed batches: with mixed file sizes, chunking
  // leaves workers idle waiting for the one big photo in their group.
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const position = cursor++;

      if (signal?.aborted) return;

      const { entry, index } = pending[position];
      const { key, uploadUrl } = uploads[position];

      const result = await uploadAsync(uploadUrl, entry.file.uri, {
        httpMethod: "PUT",
        uploadType: FileSystemUploadType.BINARY_CONTENT,

        // The signature covers Content-Type, so this header is not decoration —
        // storage rejects the PUT if it does not match what was signed.
        headers: { "Content-Type": entry.file.mimeType || "image/jpeg" },
      });

      if (result.status < 200 || result.status >= 300) {
        if (signal?.aborted) throw createUploadAbortError();

        throw new UploadError(
          "Falha ao enviar uma das fotos. Verifique sua conexão e tente novamente.",
          { status: result.status, host: hostOf(uploadUrl) },
        );
      }

      uploaded[index] = { key, fieldName: entry.fieldName };
      onUploaded?.(index, key);

      completed += 1;
      onProgress?.(completed, entries.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker),
  );

  if (signal?.aborted) throw createUploadAbortError();

  return uploaded;
}

/**
 * The size has to be the exact byte count the device will send: it goes into
 * the signature, and storage rejects a PUT whose length does not match.
 * `prepareUploadImage` always fills `fileSize` after transcoding, so a missing
 * one means the image skipped that step.
 */
function describeFile(file: UploadFile): {
  originalFilename: string;
  contentType: string;
  size: number;
} {
  if (!file.fileSize) {
    throw new UploadError(
      "Não foi possível determinar o tamanho de uma das fotos.",
    );
  }

  return {
    originalFilename: file.fileName || "photo.jpg",
    contentType: file.mimeType || "image/jpeg",
    size: file.fileSize,
  };
}
