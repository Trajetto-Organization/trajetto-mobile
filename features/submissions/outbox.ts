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

import { getSubmissionOwner } from "./submission-owner";
import {
  canActOn,
  claim,
  classifyFailure as decideFailure,
  classifyOwnership,
  nextAfterFailure,
  selectSendable,
  selectVisible,
} from "./outbox-rules";

import type {
  FailureDescription,
  OutboxFailure,
  OutboxStatus,
} from "./outbox-rules";

const OUTBOX_STORAGE_KEY = "@trajetto:outbox:v1";
const OUTBOX_DIRECTORY = "trajetto-outbox";

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

  /**
   * The driver who queued it. The queue survives logout, so this is what keeps
   * the next person to sign in on this phone from sending it under their own
   * credentials. Absent only on items queued before this field existed — see
   * `classifyOwnership`.
   */
  ownerUserId?: string;

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
    // The only place the queue still throws work away, and it does so because
    // unparseable JSON leaves nothing to retry. It is at least said out loud:
    // a driver reporting a vanished proof needs this line to exist.
    logger.error("outbox: queue file was unreadable and had to be dropped");

    await AsyncStorage.removeItem(OUTBOX_STORAGE_KEY);
    return [];
  }
}

/**
 * Disk keeps every item; the store only ever sees this session's.
 *
 * Both halves matter. Persisting everything is what lets a driver log back in
 * and find their queue intact. Publishing only what belongs to whoever is
 * signed in now is what keeps the pending screen, the badge and the banner
 * from describing someone else's work — and, since the screen's buttons act on
 * what it lists, from offering to send it.
 */
async function writeItems(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
  useOutboxStore.getState().setItems(selectVisible(items, getSubmissionOwner()));
}

/** Reads the queue from disk into the store. Called on boot and after login. */
async function loadOutbox(): Promise<OutboxItem[]> {
  return enqueueStorageMutation(async () => {
    const items = await readItems();

    useOutboxStore
      .getState()
      .setItems(selectVisible(items, getSubmissionOwner()));

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
    // Stamped here rather than passed in by each caller, so that the identity
    // the queue will later check against is by construction the same one the
    // session is running under.
    ownerUserId: getSubmissionOwner() ?? undefined,
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

/**
 * Flattens a thrown error into something the rules can read.
 *
 * The only part of the decision that needs to know about our error classes,
 * kept deliberately trivial: everything that follows from the answer lives in
 * `outbox-rules`, which imports nothing and can therefore be tested.
 */
function describeFailure(error: unknown): FailureDescription {
  if (error instanceof ApiError) {
    return {
      source: "api",
      isAuthenticationError: error.isAuthenticationError,
      isTransient: error.isTransient,
      code: error.code,
    };
  }

  if (error instanceof UploadError) return { source: "upload" };

  return { source: "unknown" };
}

function classifyFailure(error: unknown): OutboxFailure {
  return decideFailure(describeFailure(error));
}

async function recordFailure(item: OutboxItem, error: unknown): Promise<void> {
  const failure = classifyFailure(error);
  const message =
    error instanceof Error ? error.message : "Falha ao enviar o registro.";

  const next = nextAfterFailure(item, failure, Date.now());

  // Null means "leave it exactly as it is" — an expired session, which is not
  // this item's fault and says nothing about whether it would be accepted.
  if (!next) return;

  await updateItem(item.id, (current) => ({
    ...current,
    attempts: next.attempts,
    nextAttemptAt: next.nextAttemptAt,
    status: next.status,
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

  // No session, nothing to send under. The items stay exactly where they are
  // and wait for their own driver to come back.
  const ownerUserId = getSubmissionOwner();
  if (!ownerUserId) return;

  activePass = (async () => {
    const store = useOutboxStore.getState();
    store.setProcessing(true);

    try {
      const items = await loadOutbox();
      const due = selectSendable(items, ownerUserId, Date.now());

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
  const ownerUserId = getSubmissionOwner();
  if (!ownerUserId) return;

  await enqueueStorageMutation(async () => {
    const items = await readItems();

    const next = items.map((item) =>
      item.status === "parked" &&
      classifyOwnership(item, ownerUserId) === "own"
        ? { ...item, status: "pending" as const, nextAttemptAt: Date.now() }
        : item,
    );

    await writeItems(next);
  });

  await processOutbox();
}

/**
 * Puts an item back in line, at the driver's request.
 *
 * Also the one way an unclaimed item ever gets sent: pressing this is the
 * person saying the submission is theirs, so it is stamped with their id here
 * and from then on behaves like anything else they queued. An item that
 * already has an owner keeps it, so this can never hand one driver's work to
 * another.
 */
async function retryOutboxItem(itemId: string): Promise<void> {
  const ownerUserId = getSubmissionOwner();
  if (!ownerUserId) return;

  await updateItem(itemId, (item) =>
    canActOn(item, ownerUserId)
      ? claim(
          {
            ...item,
            status: "pending" as const,
            attempts: 0,
            nextAttemptAt: Date.now(),
            lastError: undefined,
          },
          ownerUserId,
        )
      : item,
  );

  await processOutbox();
}

/** Throws a submission away, photos and all. Only ever user-initiated. */
async function discardOutboxItem(itemId: string): Promise<void> {
  const ownerUserId = getSubmissionOwner();

  const items = await enqueueStorageMutation(readItems);
  const target = items.find((item) => item.id === itemId);

  // Nothing outside the UI reaches this, but the UI is not the only caller a
  // future change could add, and the cost of being wrong here is a deleted
  // proof of delivery belonging to someone who is not in the room.
  if (!target || !canActOn(target, ownerUserId)) return;

  await removeItem(itemId);
}

/**
 * Lets go of the queue in memory without touching the disk.
 *
 * Called on logout. The items stay: they are work the driver already confirmed
 * and the app promised to deliver, and a session ending — theirs, or a refresh
 * token that expired while the phone sat in a truck — says nothing about
 * whether that promise still stands. What has to end is this session's view of
 * them, so the next person to sign in starts from an empty screen.
 */
function detachOutbox(): void {
  useOutboxStore.getState().setItems([]);
}

export {
  buildPhotoPayload,
  classifyFailure,
  detachOutbox,
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
