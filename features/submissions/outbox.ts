import AsyncStorage from "@react-native-async-storage/async-storage";

import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import { apiClient, ApiError } from "@/utils/api";
import { logger } from "@/utils/logger";

import {
  uploadToStorage,
  UploadError,
  type UploadType,
} from "@/features/media/upload-to-storage";

import { useOutboxStore } from "@/store/outbox-store";
import { useConnectionStore } from "@/store/connection-store";

import { queryClient } from "@/providers/query-provider";

const OUTBOX_STORAGE_KEY = "@trajetto:outbox:v1";
const OUTBOX_DIRECTORY = "trajetto-outbox";

/**
 * Backoff between attempts after a transient failure.
 *
 * Capped rather than doubling forever: an outage that lasts a whole shift must
 * not leave the queue waiting on a timer that grew while nobody was watching.
 * Regaining signal also triggers a pass immediately, so these delays only pace
 * retries that happen while the connection looks fine but is not.
 */
const RETRY_DELAYS_MS = [0, 15_000, 60_000, 5 * 60_000, 15 * 60_000];

type OutboxKind =
  | "checklist"
  | "fuel"
  | "delivery-start-route"
  | "delivery-arrival"
  | "delivery-proof"
  | "delivery-occurrence";

/**
 * How uploaded keys enter the body: `photos` = [{key, fieldName}] (the
 * checklist), `photo` = single {key} (a refuelling), `photo-keys` = plain
 * key strings (a delivery occurrence), `proof` = photo/signature body
 * fields matched by each entry's fieldName (a delivery proof).
 */
type OutboxPhotoField = "photos" | "photo" | "photo-keys" | "proof";

/**
 * `pending` is retried on its own; `failed` needs a person to decide;
 * `parked` waits for the DELIVERIES module to come back — retrying against
 * a disabled module would burn the backoff for nothing.
 */
type OutboxStatus = "pending" | "failed" | "parked";

interface OutboxPhoto {
  uri: string;
  fileName: string;
  fileSize: number;
  mimeType: string;

  /** Which checklist question the photo answers. Absent for a refuelling. */
  fieldName?: string;

  /**
   * Filled once this file reaches storage. Kept across attempts so a retry
   * uploads only what is missing — twenty photos on a connection that drops
   * every few minutes would otherwise never get past the first few.
   */
  uploadedKey?: string;
}

interface OutboxItem {
  /**
   * Also the idempotency key. The API returns the existing record instead of
   * creating a second one, which is what makes retrying safe at all: a request
   * that succeeded but whose response was lost costs nothing to repeat.
   */
  id: string;

  kind: OutboxKind;
  businessId: string;

  /** Absent for delivery submissions — those belong to a delivery. */
  vehicleId?: string;

  /** What the pending screen shows: a plate, or "Entrega para Fulano". */
  vehicleLabel?: string;

  endpoint: string;
  body: Record<string, unknown>;

  photos: OutboxPhoto[];
  uploadType: UploadType;

  photoField: OutboxPhotoField;

  createdAt: string;
  attempts: number;
  nextAttemptAt: number;

  status: OutboxStatus;
  lastError?: string;
}

interface EnqueueSubmissionInput {
  id: string;
  kind: OutboxKind;
  businessId: string;
  vehicleId?: string;
  vehicleLabel?: string;
  endpoint: string;
  body: Record<string, unknown>;
  uploadType: UploadType;
  photoField: OutboxPhotoField;
  photos: {
    uri: string;
    fileName?: string | null;
    fileSize?: number;
    mimeType?: string | null;
    fieldName?: string;

    // Set when the file already reached storage during the attempt that failed,
    // so the queue does not send it a second time.
    uploadedKey?: string;
  }[];
}

/**
 * Why a send failed, and therefore what to do about it.
 *
 * This distinction is the whole point of the queue: no answer from the API is
 * not the same as the API saying no. The first is worth repeating forever, the
 * second never is.
 */
type OutboxFailure = "transient" | "auth" | "permanent" | "module-disabled";

// Every read-modify-write goes through here. Two screens submitting while a
// background pass is running would otherwise interleave and drop an item.
let storageQueue: Promise<unknown> = Promise.resolve();

const enqueueStorageMutation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = storageQueue.then(operation, operation);
  storageQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
};

const itemDirectory = (itemId: string) =>
  new Directory(Paths.document, OUTBOX_DIRECTORY, itemId);

async function readItems(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(OUTBOX_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as OutboxItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await AsyncStorage.removeItem(OUTBOX_STORAGE_KEY);
    return [];
  }
}

async function writeItems(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
  useOutboxStore.getState().setItems(items);
}

/** Reads the queue from disk into the store. Called on boot. */
async function loadOutbox(): Promise<OutboxItem[]> {
  return enqueueStorageMutation(async () => {
    const items = await readItems();
    useOutboxStore.getState().setItems(items);

    return items;
  });
}

async function updateItem(
  itemId: string,
  change: (item: OutboxItem) => OutboxItem,
): Promise<void> {
  await enqueueStorageMutation(async () => {
    const items = await readItems();
    const index = items.findIndex((item) => item.id === itemId);

    if (index === -1) return;

    const next = [...items];
    next[index] = change(items[index]);

    await writeItems(next);
  });
}

async function removeItem(itemId: string): Promise<void> {
  await enqueueStorageMutation(async () => {
    const items = await readItems();
    await writeItems(items.filter((item) => item.id !== itemId));
  });

  // Photos go with the item. Best-effort: a leftover directory costs disk, a
  // failed delete that propagated would cost the removal itself.
  try {
    const directory = itemDirectory(itemId);
    if (directory.exists) directory.delete();
  } catch {
    logger.dev("outbox: could not delete photo directory", { itemId });
  }
}

/**
 * Takes ownership of a submission and its photos.
 *
 * The photos are copied into a directory belonging to this item rather than
 * referenced where they are: the draft that produced them is cleared as soon as
 * the form closes, and it deletes its own directory when it goes. Copying is
 * what lets those two lifetimes stop depending on each other.
 */
async function enqueueSubmission(
  input: EnqueueSubmissionInput,
): Promise<OutboxItem> {
  const directory = itemDirectory(input.id);
  directory.create({ intermediates: true, idempotent: true });

  const photos: OutboxPhoto[] = input.photos.map((photo) => {
    const source = new File(photo.uri);
    const destination = new File(directory, `${randomUUID()}.jpg`);

    source.copy(destination);

    return {
      uri: destination.uri,
      fileName: photo.fileName || destination.name,
      fileSize: destination.size ?? photo.fileSize ?? 0,
      mimeType: photo.mimeType || "image/jpeg",
      fieldName: photo.fieldName,
      uploadedKey: photo.uploadedKey,
    };
  });

  const item: OutboxItem = {
    id: input.id,
    kind: input.kind,
    businessId: input.businessId,
    vehicleId: input.vehicleId,
    vehicleLabel: input.vehicleLabel,
    endpoint: input.endpoint,
    body: input.body,
    photos,
    uploadType: input.uploadType,
    photoField: input.photoField,
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: Date.now(),
    status: "pending",
  };

  await enqueueStorageMutation(async () => {
    const items = await readItems();

    // Re-submitting the same idempotency key replaces the queued attempt
    // instead of stacking a duplicate behind it.
    const next = items.filter((existing) => existing.id !== item.id);
    next.push(item);

    await writeItems(next);
  });

  return item;
}

/**
 * Merges uploaded keys into the request body, in the dialect each endpoint
 * speaks. Shared with submit-or-queue so the immediate path and the queued
 * path can never drift apart.
 */
function buildPhotoPayload(
  photoField: OutboxPhotoField,
  body: Record<string, unknown>,
  uploaded: { key: string; fieldName?: string }[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...body };

  if (photoField === "photos") {
    payload.photos = uploaded.map(({ key, fieldName }) => ({
      key,
      fieldName,
    }));
  } else if (photoField === "photo-keys") {
    payload.photos = uploaded.map(({ key }) => key);
  } else if (photoField === "proof") {
    const photo = uploaded.find((entry) => entry.fieldName === "photo");
    const signature = uploaded.find(
      (entry) => entry.fieldName === "signature",
    );

    if (photo) payload.photo = photo.key;
    if (signature) payload.signature = signature.key;
  } else if (uploaded[0]) {
    payload.photo = { key: uploaded[0].key };
  }

  return payload;
}

/**
 * Sends one item: photos to storage, then the record to the API.
 *
 * Keys are written down as each photo lands, so an attempt that dies halfway
 * leaves behind progress rather than orphaned uploads.
 */
async function sendItem(
  item: OutboxItem,
  onProgress?: (uploaded: number, total: number) => void,
): Promise<void> {
  const uploaded = await uploadToStorage({
    entries: item.photos.map((photo) => ({
      file: photo,
      fieldName: photo.fieldName,
      uploadedKey: photo.uploadedKey,
    })),
    uploadType: item.uploadType,
    businessId: item.businessId,
    onProgress,
    onUploaded: (index, key) => {
      void updateItem(item.id, (current) => ({
        ...current,
        photos: current.photos.map((photo, photoIndex) =>
          photoIndex === index ? { ...photo, uploadedKey: key } : photo,
        ),
      })).catch(() => undefined);
    },
  });

  const body = buildPhotoPayload(item.photoField, item.body, uploaded);

  await apiClient.request(item.endpoint, {
    method: "POST",
    body,
    headers: { "Idempotency-Key": item.id },
  });
}

function classifyFailure(error: unknown): OutboxFailure {
  if (error instanceof ApiError) {
    if (error.isAuthenticationError) return "auth";
    if (error.isTransient) return "transient";

    // The whole module is off, not this item: it parks until the module
    // comes back instead of burning retries or asking a person to decide.
    if (error.code === "MODULE_NOT_ENABLED") return "module-disabled";

    // A 4xx that is not a timeout or a rate limit is the API saying no on the
    // merits — mileage below the vehicle's, an inactive branch. Repeating it
    // produces the same answer forever.
    return "permanent";
  }

  // A failed PUT is network-shaped: an expired signature is re-signed on the
  // next attempt, and everything else is the connection.
  if (error instanceof UploadError) return "transient";

  return "transient";
}

const retryDelay = (attempts: number): number =>
  RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];

async function recordFailure(item: OutboxItem, error: unknown): Promise<void> {
  const failure = classifyFailure(error);
  const message =
    error instanceof Error ? error.message : "Falha ao enviar o registro.";

  // An expired session is not this item's fault and says nothing about whether
  // it would be accepted. It stays exactly as it is and waits for a login.
  if (failure === "auth") return;

  if (failure === "module-disabled") {
    await updateItem(item.id, (current) => ({
      ...current,
      status: "parked",
      lastError: message,
    }));

    return;
  }

  await updateItem(item.id, (current) => ({
    ...current,
    attempts: current.attempts + 1,
    nextAttemptAt: Date.now() + retryDelay(current.attempts + 1),
    status: failure === "permanent" ? "failed" : "pending",
    lastError: message,
  }));
}

// One pass at a time. Without this, a reconnect firing while a foreground
// event fires would send the same item twice — idempotency would save the
// database, but not the duplicated uploads.
let activePass: Promise<void> | null = null;

/**
 * Works through everything that is due.
 *
 * Serial rather than parallel: these are photo uploads on a phone connection,
 * and running two submissions at once makes both slower while doubling the
 * chance of a timeout.
 */
async function processOutbox(): Promise<void> {
  if (activePass) return activePass;

  // Only the device radio skips a pass — attempts with no network at all just
  // burn through the backoff schedule. `isApiUnreachable` deliberately does
  // not gate here: sending is the only probe that can clear it.
  if (useConnectionStore.getState().isDeviceOffline) return;

  activePass = (async () => {
    const store = useOutboxStore.getState();
    store.setProcessing(true);

    try {
      const items = await loadOutbox();
      const due = items.filter(
        (item) => item.status === "pending" && item.nextAttemptAt <= Date.now(),
      );

      for (const item of due) {
        store.setActive(item.id, { uploaded: 0, total: item.photos.length });

        try {
          await sendItem(item, (uploaded, total) =>
            useOutboxStore.getState().setActive(item.id, { uploaded, total }),
          );

          await removeItem(item.id);

          // The record that just landed changed data another screen is
          // caching. Nobody is watching this from a component, so the
          // invalidation has to happen here.
          const staleQueries = item.kind.startsWith("delivery-")
            ? [["my-deliveries", item.businessId]]
            : [
                ["vehicles", item.businessId],
                ["vehicle", item.businessId, item.vehicleId],
              ];

          void Promise.all(
            staleQueries.map((queryKey) =>
              queryClient.invalidateQueries({ queryKey }),
            ),
          ).catch(() => undefined);
        } catch (error) {
          await recordFailure(item, error);

          // The session is gone; nothing else in the queue will fare better.
          if (classifyFailure(error) === "auth") break;
        }
      }
    } catch (error) {
      logger.error("outbox: processing pass failed", error);
    } finally {
      const current = useOutboxStore.getState();
      current.setActive(null, null);
      current.setProcessing(false);
    }
  })().finally(() => {
    activePass = null;
  });

  return activePass;
}

/**
 * Puts parked delivery submissions back in line. Called when the session
 * learns the DELIVERIES module is enabled again — the queue itself has no
 * way to know except by trying.
 */
async function unparkOutboxItems(): Promise<void> {
  await enqueueStorageMutation(async () => {
    const items = await readItems();

    const next = items.map((item) =>
      item.status === "parked"
        ? { ...item, status: "pending" as const, nextAttemptAt: Date.now() }
        : item,
    );

    await writeItems(next);
  });

  await processOutbox();
}

/** Puts a failed item back in line, at the driver's request. */
async function retryOutboxItem(itemId: string): Promise<void> {
  await updateItem(itemId, (item) => ({
    ...item,
    status: "pending",
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastError: undefined,
  }));

  await processOutbox();
}

/** Throws a submission away, photos and all. Only ever user-initiated. */
async function discardOutboxItem(itemId: string): Promise<void> {
  await removeItem(itemId);
}

/**
 * Wipes the queue. Called on logout alongside the drafts, because both hold
 * business data belonging to the session that is ending.
 */
async function clearOutbox(): Promise<void> {
  await enqueueStorageMutation(async () => {
    await AsyncStorage.removeItem(OUTBOX_STORAGE_KEY);
    useOutboxStore.getState().setItems([]);
  });

  try {
    const root = new Directory(Paths.document, OUTBOX_DIRECTORY);
    if (root.exists) root.delete();
  } catch {
    logger.dev("outbox: could not delete photo root");
  }
}

export {
  buildPhotoPayload,
  clearOutbox,
  classifyFailure,
  discardOutboxItem,
  enqueueSubmission,
  loadOutbox,
  processOutbox,
  retryOutboxItem,
  unparkOutboxItems,
};

export type {
  EnqueueSubmissionInput,
  OutboxFailure,
  OutboxItem,
  OutboxKind,
  OutboxPhoto,
  OutboxPhotoField,
  OutboxStatus,
};
