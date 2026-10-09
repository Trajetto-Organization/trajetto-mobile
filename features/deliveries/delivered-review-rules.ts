import { acceptedDeviceId } from "@/features/device/device-identity-rules";
import {
  deliveredOccurrenceBodySchema,
  type DeliveredOccurrenceBody,
} from "@/schemas/delivery";
import { normalizeSingleLineText } from "@/schemas/text-rules";

import { occurrenceFormPart, typeFormOf } from "@/features/occurrences/occurrence-form";
import type { DraftAnswers } from "@/features/occurrences/draft-answers";

import { deliveredMissing, type DeliveredDraftState } from "./delivered-requirements";
import type { DriverOccurrenceType } from "./types";
import { devicePrecheckSchema } from "@/schemas/device-precheck";

/**
 * A queued delivery proof (`delivery-delivered`) the API refused over its
 * form or its type, answered again on the proof screen (decision 14.3;
 * design §8.3). What was collected at the stop — the receipt, the signature,
 * the photos, the moment and the place — stays as queued: only the type, the
 * answers and the texts change, under the same submission id.
 */

interface QueuedDelivered {
  id: string;
  createdAt: string;
  body: Record<string, unknown>;
  photos: ReadonlyArray<{ fieldName?: string }>;
}

/** What the queued item already carries, for the type's requirements. */
function queuedDeliveredFiles(
  photos: ReadonlyArray<{ fieldName?: string }>,
): DeliveredDraftState {
  return {
    receiptPhoto: photos.some((photo) => photo.fieldName === "receipt_photo"),
    signature: photos.some((photo) => photo.fieldName === "signature"),
    photos: photos.filter((photo) => photo.fieldName === "photos").length,
  };
}

const textOr = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const numberOr = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** The queued body's texts, to prefill the screen. */
function queuedDeliveredTexts(body: Record<string, unknown>): {
  typeId: string | null;
  receivedBy: string;
  description: string;
} {
  return {
    typeId: typeof body.occurrenceTypeId === "string" ? body.occurrenceTypeId : null,
    receivedBy: textOr(body.received_by),
    description: textOr(body.description),
  };
}

/**
 * The body to put back in the queue, checked like a new proof. Throws the
 * requirement's message when the chosen type asks for what the item does not
 * carry (a signature that was never collected cannot be added now), and
 * `OccurrenceFormError` for answers the form refuses.
 */
function revisedDeliveredBody(
  item: QueuedDelivered,
  change: {
    type: DriverOccurrenceType;
    answers: DraftAnswers;
    receivedBy?: string;
    description?: string;
  },
): DeliveredOccurrenceBody {
  const [missing] = deliveredMissing(change.type, queuedDeliveredFiles(item.photos));

  if (missing) throw new Error(missing.message);

  const { body } = item;
  const precheck = devicePrecheckSchema.safeParse(body.device_precheck);
  const latitude = numberOr(body.latitude);
  const longitude = numberOr(body.longitude);

  // The form first, with its own error (the screen marks each field).
  const formPart = occurrenceFormPart(typeFormOf(change.type), change.answers);

  const parsed = deliveredOccurrenceBodySchema.safeParse({
    // The same submission: a resend is recognised, never a second proof.
    client_submission_id: textOr(body.client_submission_id, item.id),
    occurrenceTypeId: change.type.id,
    // When the receipt was signed, not when it was reviewed (MOB-08).
    occurred_at: textOr(body.occurred_at, item.createdAt),
    description: change.description ?? textOr(body.description),
    received_by: normalizeSingleLineText(change.receivedBy ?? textOr(body.received_by)),
    ...(latitude !== undefined && longitude !== undefined && { latitude, longitude }),
    ...formPart,
    // The receipt is the queued one, so its pre-check still holds (14.2).
    ...(precheck.success && { device_precheck: precheck.data }),
    // And so do the phone and the instant of its capture (proof design §8.3).
    ...(acceptedDeviceId(body.device_id) && { device_id: body.device_id }),
    ...(typeof body.photo_taken_at === "string" && { photo_taken_at: body.photo_taken_at }),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Entrega inválida.");
  }

  return parsed.data;
}

export { queuedDeliveredFiles, queuedDeliveredTexts, revisedDeliveredBody };
export type { QueuedDelivered };
