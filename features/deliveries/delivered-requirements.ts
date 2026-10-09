/**
 * "Entregar" as a DELIVERED occurrence (decision 14.3; design §8.2), as the
 * app decides it. Pure: which flow the screen takes, what the chosen type
 * asks for, and what is still missing — with the API's own messages (the
 * copy of its category rules) — are decisions a test reads without a phone.
 */

import {
  missingRequirements,
  type MissingRequirement,
} from "./occurrence-category-rules";
import type { DriverDelivery, DriverOccurrenceType } from "./types";

/** The outbox kind of a delivery registered through its type. */
const DELIVERED_KIND = "delivery-delivered" as const;

/**
 * Which flow "Entregar" takes:
 * - `legacy`: the cached day has no delivery types (written before the
 *   update, or an API before them) — the old proof route, as before;
 * - `single`: one type, straight to it (one tap, as today);
 * - `pick`: more than one, the default first and preselected.
 */
type DeliveredChoice =
  | { mode: "legacy" }
  | { mode: "single"; type: DriverOccurrenceType }
  | { mode: "pick"; types: DriverOccurrenceType[]; initial: DriverOccurrenceType };

function deliveredChoiceOf(
  types: readonly DriverOccurrenceType[] | null | undefined,
): DeliveredChoice {
  const delivered = (types ?? []).filter(
    (type) => (type.category ?? "DELIVERED") === "DELIVERED",
  );

  if (delivered.length === 0) return { mode: "legacy" };
  if (delivered.length === 1) return { mode: "single", type: delivered[0] };

  const initial = delivered.find((type) => type.is_default) ?? delivered[0];

  return { mode: "pick", types: delivered, initial };
}

/** What the proof screen renders for a delivery type. */
interface DeliveredSections {
  /** The receipt photo: always offered, required or optional. */
  receipt: "required" | "optional";
  /** The pad is always offered in a delivery type; this says if required. */
  signature: "required" | "optional";
  /** Additional photos (up to 5): shown only when the type asks for them. */
  photos: boolean;
}

/** The legacy flow asks what the old screen asked: receipt yes, signature optional. */
const LEGACY_SECTIONS: DeliveredSections = {
  receipt: "required",
  signature: "optional",
  photos: false,
};

function deliveredSectionsOf(type: DriverOccurrenceType | null): DeliveredSections {
  if (!type) return LEGACY_SECTIONS;

  return {
    receipt: type.requires_receipt_photo ? "required" : "optional",
    signature: type.requires_signature ? "required" : "optional",
    photos: type.requires_photo === true,
  };
}

/** The most additional photos a report takes (the API's limit). */
const DELIVERED_MAX_PHOTOS = 5;

/** What the screen holds now. */
interface DeliveredDraftState {
  receiptPhoto: boolean;
  signature: boolean;
  photos: number;
}

/**
 * What the type requires and the driver has not given yet, in the API's
 * order and with its messages: the same refusals the API would give, before
 * the offline queue (a 400 there is a failure the driver can only discard).
 */
function deliveredMissing(
  type: DriverOccurrenceType | null,
  draft: DeliveredDraftState,
): MissingRequirement[] {
  const sections = deliveredSectionsOf(type);

  return missingRequirements(
    {
      category: "DELIVERED",
      requires_receipt_photo: sections.receipt === "required",
      requires_signature: sections.signature === "required",
      requires_photo: sections.photos,
    },
    { receipt_photo: draft.receiptPhoto, signature: draft.signature, photos: draft.photos },
  );
}

/**
 * Whether this driver's delivery request waits for the tower (decision 6.3):
 * "Entregar" waits too, "Ocorrência" stays available.
 */
function deliveredRequestPending(
  delivery: Pick<DriverDelivery, "authorization_request">,
  deliveredTypes: readonly DriverOccurrenceType[] | null | undefined,
): boolean {
  const request = delivery.authorization_request;

  if (!request || request.status !== "PENDING") return false;

  return (deliveredTypes ?? []).some((type) => type.id === request.occurrenceTypeId);
}

const DELIVERED_PENDING_LABEL = "Entrega aguardando autorização";

/** A file the queue uploads, named by the body field it fills. */
interface DeliveredFileEntry<F> {
  file: F;
  fieldName: "receipt_photo" | "signature" | "photos";
}

/** The files of a delivery report, in the order they upload. */
function deliveredFiles<F>(input: {
  receiptPhoto: F | null;
  signature: F | null;
  photos: readonly F[];
}): DeliveredFileEntry<F>[] {
  return [
    ...(input.receiptPhoto ? [{ file: input.receiptPhoto, fieldName: "receipt_photo" as const }] : []),
    ...(input.signature ? [{ file: input.signature, fieldName: "signature" as const }] : []),
    ...input.photos.map((file) => ({ file, fieldName: "photos" as const })),
  ];
}

/**
 * The uploaded keys into the report's body (photoField "occurrence-files"):
 * the receipt and the signature as strings, the photos as an array.
 */
function occurrenceFilesPayload(
  body: Record<string, unknown>,
  uploaded: ReadonlyArray<{ key: string; fieldName?: string }>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...body };
  const receipt = uploaded.find((entry) => entry.fieldName === "receipt_photo");
  const signature = uploaded.find((entry) => entry.fieldName === "signature");
  const photos = uploaded.filter((entry) => entry.fieldName === "photos").map((entry) => entry.key);

  if (receipt) payload.receipt_photo = receipt.key;
  if (signature) payload.signature = signature.key;
  if (photos.length > 0) payload.photos = photos;

  return payload;
}

/** The toast after the API answered (or the queue will). */
function deliveredSentNotice(status: string | null | undefined): { title: string; message: string } {
  if (status === "PENDING") {
    return {
      title: "Entrega registrada",
      message: "Aguardando autorização da torre.",
    };
  }

  return { title: "Entrega registrada!", message: "A entrega foi comprovada." };
}

export {
  DELIVERED_KIND,
  DELIVERED_MAX_PHOTOS,
  DELIVERED_PENDING_LABEL,
  LEGACY_SECTIONS,
  deliveredChoiceOf,
  deliveredFiles,
  deliveredMissing,
  deliveredRequestPending,
  deliveredSectionsOf,
  deliveredSentNotice,
  occurrenceFilesPayload,
};
export type { DeliveredChoice, DeliveredDraftState, DeliveredFileEntry, DeliveredSections };
