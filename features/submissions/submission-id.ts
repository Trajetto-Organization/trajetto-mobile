import AsyncStorage from "@react-native-async-storage/async-storage";

import { randomUUID } from "expo-crypto";
import { Directory, Paths } from "expo-file-system";

import { detachOutbox } from "./outbox";
import { countOpenDrafts } from "./logout-rules";
import { setSubmissionOwner } from "./submission-owner";

type SubmissionKind = "fuel" | "checklist";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUBMISSION_STORAGE_PREFIX = "@trajetto:submission:";
const inFlightSubmissionIds = new Map<string, Promise<string>>();

let submissionMutationQueue: Promise<void> = Promise.resolve();

let submissionPersistenceEnabled = false;
let submissionPersistenceEpoch = 0;

/**
 * Draft directories a submission in flight is still reading from, by
 * submission id, with how many holders each has.
 *
 * A 401 that cannot be refreshed logs out from inside the request, and the
 * logout deletes every draft — before the error even reaches the code that
 * would have queued the submission with a copy of its photos.
 */
const heldSubmissionIds = new Map<string, number>();

const createAbortError = (): Error => {
  const error = new Error("Submission persistence is disabled");
  error.name = "AbortError";

  return error;
};

const enqueueSubmissionMutation = async <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  const result = submissionMutationQueue.then(operation, operation);
  submissionMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

/**
 * Opens persistence for a session, and records whose it is.
 *
 * The user id is not decoration: it is what every queued submission is stamped
 * with, and therefore what decides, after the next logout, which items the
 * queue may still send.
 */
export function enableSubmissionPersistence(userId: string): void {
  submissionPersistenceEnabled = true;
  setSubmissionOwner(userId);
}

export function disableSubmissionPersistence(): void {
  submissionPersistenceEnabled = false;
  submissionPersistenceEpoch += 1;
  inFlightSubmissionIds.clear();
  setSubmissionOwner(null);
}

export function getSubmissionPersistenceEpoch(): number {
  return submissionPersistenceEpoch;
}

export function isSubmissionPersistenceActive(epoch: number): boolean {
  return submissionPersistenceEnabled && epoch === submissionPersistenceEpoch;
}

export function createSubmissionStorageKey(
  kind: SubmissionKind,
  userId: string,
  businessId: string,
  vehicleId: string,
) {
  return `@trajetto:submission:${kind}:${userId}:${businessId}:${vehicleId}`;
}

export function getOrCreateSubmissionId(storageKey: string): Promise<string> {
  if (!submissionPersistenceEnabled) return Promise.reject(createAbortError());

  const existingRequest = inFlightSubmissionIds.get(storageKey);
  if (existingRequest) return existingRequest;

  const request = enqueueSubmissionMutation(async () => {
    if (!submissionPersistenceEnabled) throw createAbortError();
    const storedId = await AsyncStorage.getItem(storageKey);

    if (!submissionPersistenceEnabled) throw createAbortError();
    if (storedId && UUID_PATTERN.test(storedId)) return storedId;

    const submissionId = randomUUID();
    await AsyncStorage.setItem(storageKey, submissionId);

    if (!submissionPersistenceEnabled) {
      await AsyncStorage.removeItem(storageKey);
      throw createAbortError();
    }

    return submissionId;
  });

  inFlightSubmissionIds.set(storageKey, request);
  void request.then(
    () => undefined,
    () => inFlightSubmissionIds.delete(storageKey),
  );

  return request;
}

/**
 * How many half-filled forms of this user a logout would delete — for the
 * logout warning. Zero when storage cannot be read: the warning is a courtesy
 * and must never block signing out.
 */
export async function countOpenSubmissionDrafts(
  userId: string | null,
): Promise<number> {
  try {
    return countOpenDrafts(await AsyncStorage.getAllKeys(), userId);
  } catch {
    return 0;
  }
}

export async function clearSubmissionId(storageKey: string): Promise<void> {
  inFlightSubmissionIds.delete(storageKey);
  await enqueueSubmissionMutation(() => AsyncStorage.removeItem(storageKey));
}

/**
 * Keeps a submission's draft photos out of the logout's cleanup until the
 * returned function is called.
 *
 * Held for as long as the submission is being sent: pressing send is the
 * driver finishing the work, and a session that ends in that window must not
 * take the photos the queue is about to copy. The holder deletes the draft
 * itself once it is settled, as it always has; anything a killed app left
 * behind goes with the next logout, when nothing holds it any more.
 */
export function holdSubmissionDrafts(submissionId: string): () => void {
  heldSubmissionIds.set(
    submissionId,
    (heldSubmissionIds.get(submissionId) ?? 0) + 1,
  );

  let released = false;

  return () => {
    if (released) return;
    released = true;

    const holders = (heldSubmissionIds.get(submissionId) ?? 1) - 1;
    if (holders > 0) heldSubmissionIds.set(submissionId, holders);
    else heldSubmissionIds.delete(submissionId);
  };
}

/** Deletes every draft under `trajetto-drafts/<kind>/<id>` that is not held. */
function deleteUnheldDrafts(draftRoot: Directory): void {
  if (heldSubmissionIds.size === 0) {
    draftRoot.delete();
    return;
  }

  for (const kindEntry of draftRoot.list()) {
    if (!(kindEntry instanceof Directory)) {
      kindEntry.delete();
      continue;
    }

    for (const draftEntry of kindEntry.list()) {
      if (!heldSubmissionIds.has(draftEntry.name)) draftEntry.delete();
    }
  }
}

/**
 * Removes every persisted form key and photo after an explicit/forced logout.
 *
 * Half-filled forms go; the queue does not. The line between them is whether
 * the driver already pressed send: a draft is work in progress, and losing it
 * costs the minutes since the form was opened. A queued submission is work the
 * driver considers finished and the app promised to deliver — a proof of
 * delivery collected in a basement, sometimes the only record that the parcel
 * ever arrived. Wiping that on logout meant a refresh token expiring on a
 * Sunday could erase Friday's evidence, with nobody ever told.
 *
 * So the queue is only detached from this session's view of it. What keeps the
 * next person to sign in from touching it is `ownerUserId`, not deletion.
 */
export async function clearAllSubmissionData(): Promise<void> {
  disableSubmissionPersistence();

  detachOutbox();

  await enqueueSubmissionMutation(async () => {
    const keys = await AsyncStorage.getAllKeys();
    const submissionKeys = keys.filter((key) =>
      key.startsWith(SUBMISSION_STORAGE_PREFIX),
    );

    if (submissionKeys.length > 0) {
      await AsyncStorage.multiRemove(submissionKeys);
    }

    const draftRoot = new Directory(Paths.document, "trajetto-drafts");
    if (draftRoot.exists) deleteUnheldDrafts(draftRoot);
  });
}
