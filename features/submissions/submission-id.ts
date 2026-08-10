import AsyncStorage from "@react-native-async-storage/async-storage";

import { randomUUID } from "expo-crypto";
import { Directory, Paths } from "expo-file-system";

type SubmissionKind = "fuel" | "checklist";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUBMISSION_STORAGE_PREFIX = "@trajetto:submission:";
const inFlightSubmissionIds = new Map<string, Promise<string>>();

let submissionMutationQueue: Promise<void> = Promise.resolve();

let submissionPersistenceEnabled = false;
let submissionPersistenceEpoch = 0;

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

export function enableSubmissionPersistence(): void {
  submissionPersistenceEnabled = true;
}

export function disableSubmissionPersistence(): void {
  submissionPersistenceEnabled = false;
  submissionPersistenceEpoch += 1;
  inFlightSubmissionIds.clear();
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

export async function clearSubmissionId(storageKey: string): Promise<void> {
  inFlightSubmissionIds.delete(storageKey);
  await enqueueSubmissionMutation(() => AsyncStorage.removeItem(storageKey));
}

/** Removes every persisted form key and photo after an explicit/forced logout. */
export async function clearAllSubmissionData(): Promise<void> {
  disableSubmissionPersistence();

  await enqueueSubmissionMutation(async () => {
    const keys = await AsyncStorage.getAllKeys();
    const submissionKeys = keys.filter((key) =>
      key.startsWith(SUBMISSION_STORAGE_PREFIX),
    );

    if (submissionKeys.length > 0) {
      await AsyncStorage.multiRemove(submissionKeys);
    }

    const draftRoot = new Directory(Paths.document, "trajetto-drafts");
    if (draftRoot.exists) draftRoot.delete();
  });
}
