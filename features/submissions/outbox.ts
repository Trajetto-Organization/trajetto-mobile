import AsyncStorage from "@react-native-async-storage/async-storage";

import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import { apiClient, ApiError } from "@/utils/api";
import { logger } from "@/utils/logger";
import { reportEvent } from "@/utils/telemetry";

import {
  uploadToStorage,
  UploadError,
  type UploadType,
} from "@/features/media/upload-to-storage";

import { useOutboxStore } from "@/store/outbox-store";
import { useConnectionStore } from "@/store/connection-store";

import { queryClient } from "@/providers/query-provider";

import { getSubmissionOwner } from "./submission-owner";
import { bumpQueuedMileage } from "./queue-decision";
import { shouldRequeueAfterUpgrade, upcastOutboxItem } from "./outbox-schema";

import { OUTBOX_SCHEMA_VERSION, appVersionLabel } from "@/utils/client-version";
import { moduleOfSubmission } from "@/features/access/module-rules";
import {
  forgetModuleObservations,
  moduleObservation,
  onModulesObserved,
} from "@/features/access/module-observations";
import {
  canActOn,
  claim,
  classifyFailure as decideFailure,
  classifyOwnership,
  forgetUploads,
  honouredRetryAfter,
  isHurriableBy,
  isSendExpired,
  nextAfterFailure,
  selectSendable,
  selectVisible,
  shouldUnpark,
  START_ROUTE_EXPIRED_MESSAGE,
} from "./outbox-rules";

import type {
  FailureDescription,
  ModuleObservation,
  OutboxFailure,
  OutboxStatus,
} from "./outbox-rules";

import { hasRefusalRules, refusalVerdict } from "./kind-refusals";
import { afterSubmissionSent, afterSubmissionSettled } from "./kind-effects";
import { isPauseOutboxKind } from "@/features/pauses/pause-rules";
import { occurrenceFilesPayload } from "@/features/deliveries/delivered-requirements";

const OUTBOX_STORAGE_KEY = "@trajetto:outbox:v1";
const OUTBOX_DIRECTORY = "trajetto-outbox";

type OutboxKind =
  | "checklist"
  | "fuel"
  | "delivery-start-route"
  | "delivery-arrival"
  | "delivery-proof"
  | "delivery-occurrence"
  // Decision 14.3: "Entregar" as a DELIVERED occurrence (contract 3). Its
  // own kind, not delivery-occurrence: its effects, label and refusals are
  // the proof's. Items of "delivery-proof" queued before stay valid (the
  // legacy route remains), so nothing is upcast.
  | "delivery-delivered"
  // The driver's pause gestures (decision 6.1) and "Estou a caminho" (6.4).
  // Under Entregas by their `delivery-` prefix (moduleOfSubmission).
  | "delivery-pause-start"
  | "delivery-pause-end"
  | "delivery-on-the-way";

/**
 * How uploaded keys enter the body: `photos` = [{key, fieldName}] (the
 * checklist), `photo` = single {key} (a refuelling), `photo-keys` = plain
 * key strings (a delivery occurrence), `proof` = photo/signature body
 * fields matched by each entry's fieldName (a delivery proof),
 * `occurrence-files` = receipt_photo/signature strings and a photos array,
 * by fieldName (a DELIVERED occurrence, decision 14.3).
 */
type OutboxPhotoField = "photos" | "photo" | "photo-keys" | "proof" | "occurrence-files";

/**
 * `pending` is retried on its own; `failed` needs a person to decide;
 * `parked` waits for its module (Gestão de Frota or Entregas, by kind) to
 * come back — retrying against a disabled module would burn the backoff for
 * nothing.
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

  /**
   * How many times the photos went up again because the API no longer found
   * them. Capped by `MAX_REUPLOADS`; absent on items that never needed it.
   */
  reuploads?: number;

  status: OutboxStatus;
  lastError?: string;

  /**
   * When the API last refused it because its module was off. Only a newer
   * word from the server that the module is on sends it again (see
   * `shouldUnpark`). Absent on items parked by older builds.
   */
  parkedAt?: number;

  /**
   * The shape this item was written in (`outbox-schema.upcastOutboxItem`)
   * and the build that wrote it. Absent on items from before these fields.
   */
  schemaVersion?: number;
  appVersion?: string;

  /**
   * Why a failed item failed, and on which build. A `contract` failure is
   * sent again by itself once the app is updated — see
   * `shouldRequeueAfterUpgrade`.
   */
  failure?: OutboxFailure;
  failedOnAppVersion?: string;

  /**
   * The API's code for that refusal, when it sent one. What lets a kind offer
   * the fix its contract names instead of a resend that meets the same
   * answer — an occurrence whose form changed is reopened for review
   * (features/occurrences/occurrence-queue-rules).
   */
  failureCode?: string;
}

interface EnqueueSubmissionInput {
  id: string;
  kind: OutboxKind;
  businessId: string;

  /**
   * Who pressed send, captured before sending. Only needed when the session
   * may have ended in between: a 401 logs out from inside the request, and
   * the item must still belong to the driver whose work it is.
   */
  ownerUserId?: string;

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

  /** The `Retry-After` of the attempt that failed, when the API sent one. */
  retryAfterMs?: number;
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

    // Whatever build wrote them, they are read in the current shape.
    return Array.isArray(parsed) ? parsed.map(upcastOutboxItem) : [];
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

/**
 * Reads the queue from disk into the store. Called on boot, after login and
 * at the start of every pass.
 *
 * Also where an app update is noticed: an item that failed on the CONTRACT
 * under another build goes back in line, once, since this build may speak
 * what the API asked for. It stays visible as failed until then.
 */
async function loadOutbox(): Promise<OutboxItem[]> {
  return enqueueStorageMutation(async () => {
    const stored = await readItems();
    const currentAppVersion = appVersionLabel();

    const requeued = stored.filter((item) =>
      shouldRequeueAfterUpgrade(item, currentAppVersion),
    );

    if (requeued.length === 0) {
      useOutboxStore
        .getState()
        .setItems(selectVisible(stored, getSubmissionOwner()));

      return stored;
    }

    const items = stored.map((item) =>
      requeued.includes(item)
        ? {
            ...item,
            status: "pending" as const,
            attempts: 0,
            nextAttemptAt: Date.now(),
            lastError: undefined,
            failure: undefined,
            failedOnAppVersion: undefined,
            failureCode: undefined,
          }
        : item,
    );

    await writeItems(items);

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
    // session is running under. The one exception is a submission that saw
    // its session end: it carries the owner it started with.
    ownerUserId: input.ownerUserId ?? getSubmissionOwner() ?? undefined,
    vehicleId: input.vehicleId,
    vehicleLabel: input.vehicleLabel,
    endpoint: input.endpoint,
    body: input.body,
    photos,
    uploadType: input.uploadType,
    photoField: input.photoField,
    createdAt: new Date().toISOString(),
    attempts: 0,

    // Due at once, unless the API that just refused it asked for time.
    nextAttemptAt: Date.now() + honouredRetryAfter(input.retryAfterMs),
    status: "pending",

    schemaVersion: OUTBOX_SCHEMA_VERSION,
    appVersion: appVersionLabel() ?? undefined,
  };

  await enqueueStorageMutation(async () => {
    const items = await readItems();

    // Re-submitting the same idempotency key replaces the queued attempt
    // instead of stacking a duplicate behind it.
    const next = items.filter((existing) => existing.id !== item.id);
    next.push(item);

    await writeItems(next);
  });

  // The reading this item will report is the vehicle's mileage as far as the
  // next form on this phone is concerned — see `bumpQueuedMileage`.
  const mileage = Number(input.body.current_mileage);

  if (
    (input.kind === "fuel" || input.kind === "checklist") &&
    input.vehicleId &&
    Number.isFinite(mileage)
  ) {
    queryClient.setQueryData(
      ["vehicle", input.businessId, input.vehicleId],
      (vehicle: { current_mileage?: number | null } | undefined) =>
        bumpQueuedMileage(vehicle, mileage),
    );
  }

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
  } else if (photoField === "occurrence-files") {
    return occurrenceFilesPayload(payload, uploaded);
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
): Promise<unknown> {
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

  // The answer is returned for the kinds that keep something from it (the
  // "a caminho" instant, see kind-effects).
  return apiClient.request(item.endpoint, {
    method: "POST",
    body,
    headers: {
      "Idempotency-Key": item.id,

      // This attempt's instant, by the same clock that stamped the body's
      // `occurred_at` at the tap. The API only uses the difference, so a
      // phone set to the wrong time still reports the right hour (MOB-08).
      "X-Client-Sent-At": new Date().toISOString(),
    },
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
      retryAfterMs: error.retryAfterMs,
    };
  }

  if (error instanceof UploadError) return { source: "upload" };

  return { source: "unknown" };
}

function classifyFailure(error: unknown): OutboxFailure {
  return decideFailure(describeFailure(error));
}

async function recordFailure(
  item: OutboxItem,
  error: unknown,
  // A kind's own reading of the refusal (kind-refusals: "retry" = transient).
  override?: OutboxFailure,
): Promise<void> {
  const description = describeFailure(error);
  const failure = override ?? decideFailure(description);
  const message =
    error instanceof Error ? error.message : "Falha ao enviar o registro.";

  const failedAt = Date.now();
  const next = nextAfterFailure(item, failure, failedAt, {
    retryAfterMs: description.retryAfterMs,
  });

  // Null means "leave it exactly as it is" — an expired session, which is not
  // this item's fault and says nothing about whether it would be accepted.
  if (!next) return;

  // A proof refused for good, or one still failing after three tries, used to
  // be visible only on the driver's pending screen. The first retries of a
  // flaky network are not news.
  if (failure !== "transient" || next.attempts >= 3) {
    reportEvent("outbox_item_failed", {
      kind: item.kind,
      failure,
      code: description.code ?? undefined,
      attempts: next.attempts,

      // Which leg failed, and how (OBS-12): a PUT the bucket refused (403,
      // a credential rotated wrong) looks, to the driver, exactly like a
      // phone with no signal. The host, never the signed URL.
      source: description.source,
      status:
        error instanceof UploadError
          ? error.status
          : error instanceof ApiError
            ? error.status
            : undefined,
      host: error instanceof UploadError ? error.host : undefined,
      category: error instanceof ApiError ? error.category : undefined,
      where: message,
    });
  }

  await updateItem(item.id, (current) => ({
    ...current,

    // The stored objects are gone; the files on the phone are not.
    photos:
      failure === "reupload" ? forgetUploads(current.photos) : current.photos,
    reuploads:
      failure === "reupload" ? (current.reuploads ?? 0) + 1 : current.reuploads,
    attempts: next.attempts,
    nextAttemptAt: next.nextAttemptAt,
    status: next.status,
    lastError: message,

    // The refusal every later "the module is on" is measured against.
    parkedAt: next.status === "parked" ? failedAt : undefined,

    // Which kind of "no", and on which build: a contract refusal goes out
    // again once the app changes (`loadOutbox`).
    failure: next.status === "failed" ? failure : undefined,
    failedOnAppVersion:
      next.status === "failed" ? (appVersionLabel() ?? undefined) : undefined,
    failureCode:
      next.status === "failed" ? (description.code ?? undefined) : undefined,
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
        // A departure queued half a day ago would start whatever route the
        // API finds today (see isSendExpired). It is failed rather than sent
        // or dropped: visible on the pending screen, with what to do.
        if (isSendExpired(item, Date.now())) {
          await updateItem(item.id, (current) => ({
            ...current,
            status: "failed",
            failure: "permanent",
            lastError: START_ROUTE_EXPIRED_MESSAGE,
            failedOnAppVersion: appVersionLabel() ?? undefined,
          }));

          continue;
        }

        store.setActive(item.id, { uploaded: 0, total: item.photos.length });

        try {
          const response = await sendItem(item, (uploaded, total) =>
            useOutboxStore.getState().setActive(item.id, { uploaded, total }),
          );

          // What the answer changes on the phone for this kind (the pause
          // record, the "a caminho" instant) — the same code as a send at the
          // tap. Awaited BEFORE the item leaves: a screen that sees it gone
          // must already see its effect, or a pause answer asked while it
          // was queued wins in between. Best-effort: it has landed anyway.
          await afterSubmissionSent(item, response).catch(() => undefined);

          await removeItem(item.id);

          // The record that just landed changed data another screen is
          // caching. Nobody is watching this from a component, so the
          // invalidation has to happen here. A pause changes nothing in the
          // deliveries list; its own state is refreshed by the effect above.
          const staleQueries = isPauseOutboxKind(item.kind)
            ? []
            : item.kind.startsWith("delivery-")
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
          // Some kinds' contracts read a refusal as "already done" or "the
          // order of the queue will fix it" (kind-refusals). The queue is
          // read as it is NOW: items this pass already sent are gone. One
          // that cannot be read gives no verdict — the default keeps the
          // item, where a guess could drop it.
          const verdict = hasRefusalRules(item.kind)
            ? await enqueueStorageMutation(readItems).then(
                (queue) => refusalVerdict(item, describeFailure(error), queue),
                () => null,
              )
            : null;

          if (verdict?.outcome === "settled") {
            // Before the removal, for the same reason as a sent item.
            await afterSubmissionSettled(item, verdict).catch(() => undefined);
            await removeItem(item.id);
            continue;
          }

          await recordFailure(
            item,
            error,
            verdict?.outcome === "retry" ? "transient" : undefined,
          );

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
 * A person asking to send now (MOB-15) — the logout warning and the pending
 * screen, both through `useSendPendingNow`: this driver's pending items are
 * made due and a pass runs over them. Resolves with how many of their pending
 * items are still waiting afterwards, so the caller can say it did not all go.
 *
 * `processOutbox` alone sent only what the backoff already allowed — nothing,
 * typically, for items that had failed on a weak signal (`isHurriableBy`).
 */
async function sendPendingNow(): Promise<{ remaining: number }> {
  const ownerUserId = getSubmissionOwner();
  if (!ownerUserId) return { remaining: 0 };

  await enqueueStorageMutation(async () => {
    const items = await readItems();
    const now = Date.now();

    const due = items.filter(
      (item) => isHurriableBy(item, ownerUserId) && item.nextAttemptAt > now,
    );

    if (due.length === 0) return;

    await writeItems(
      items.map((item) =>
        due.includes(item) ? { ...item, nextAttemptAt: now } : item,
      ),
    );
  });

  // A pass already running chose its items before these were due: let it
  // finish, then run one that sees them.
  if (activePass) await activePass;
  await processOutbox();

  const left = await enqueueStorageMutation(readItems);

  return {
    remaining: left.filter((item) => isHurriableBy(item, ownerUserId)).length,
  };
}

/** The newest word from the server about the module this item needs. */
function observationFor(item: OutboxItem): ModuleObservation | null {
  const module = moduleOfSubmission(item.kind);
  if (!module) return null;

  return moduleObservation(item.businessId, module);
}

/**
 * Puts back in line the parked items whose module the server has said, since
 * refusing them, is enabled for their company (`shouldUnpark`).
 *
 * Runs on every new word about a plan (`module-observations`), which is the
 * only thing that sends a parked item again on its own (MOB-03): no screen's
 * query succeeding does it any more — that is what looped. Safe to call from
 * anywhere and as often as anyone likes: without new evidence nothing moves,
 * so repeated calls cannot turn into repeated sends.
 */
async function unparkOutboxItems(): Promise<void> {
  const ownerUserId = getSubmissionOwner();
  if (!ownerUserId) return;

  const unparked = await enqueueStorageMutation(async () => {
    const items = await readItems();
    const now = Date.now();
    let count = 0;

    const next = items.map((item) => {
      if (classifyOwnership(item, ownerUserId) !== "own") return item;
      if (!shouldUnpark(item, observationFor(item))) return item;

      count += 1;

      return {
        ...item,
        status: "pending" as const,
        nextAttemptAt: now,
        parkedAt: undefined,
      };
    });

    if (count > 0) await writeItems(next);

    return count;
  });

  if (unparked > 0) await processOutbox();
}

// Subscribed at load: the session publishes what it learns about a plan
// without knowing the queue exists (see module-observations).
onModulesObserved(unparkOutboxItems);

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
            parkedAt: undefined,
          },
          ownerUserId,
        )
      : item,
  );

  await processOutbox();
}

/**
 * Puts a failed item back in line with a body the driver corrected, at their
 * request — an occurrence answered again after its form changed (contract
 * §6). The same id, so the API still records it once; the photos, their
 * uploads and the moment it was queued are kept.
 *
 * Only a failed item of this driver's: a pending one may be on its way right
 * now, and rewriting it under the pass would send one body and keep another.
 * Resolves with whether the item was revised.
 */
async function reviseOutboxItem(
  itemId: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const ownerUserId = getSubmissionOwner();
  if (!ownerUserId) return false;

  let revised = false;

  await updateItem(itemId, (item) => {
    if (classifyOwnership(item, ownerUserId) !== "own" || item.status !== "failed") {
      return item;
    }

    revised = true;

    return {
      ...item,
      body,
      status: "pending" as const,
      attempts: 0,
      nextAttemptAt: Date.now(),
      lastError: undefined,
      failure: undefined,
      failedOnAppVersion: undefined,
      failureCode: undefined,
    };
  });

  // A pass already running chose its items before this one was due: it goes
  // with the next one, right after.
  if (revised) void Promise.resolve(activePass).then(() => processOutbox());

  return revised;
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

  // What the server told this session is not evidence for the next one.
  forgetModuleObservations();
}

export {
  buildPhotoPayload,
  classifyFailure,
  describeFailure,
  detachOutbox,
  discardOutboxItem,
  enqueueSubmission,
  loadOutbox,
  processOutbox,
  retryOutboxItem,
  reviseOutboxItem,
  sendPendingNow,
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
