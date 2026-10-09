/**
 * The shape of a half-done proof or occurrence, and how it comes back.
 *
 * Pure, with no device import (its one import, the occurrence form's
 * answers, is itself import-free): what is stored, under which key, and what
 * a draft becomes when one of its files did not survive — the parts a test
 * reads without a device. The I/O is in `delivery-draft.ts`.
 */

import {
  reviveDraftAnswers,
  type DraftAnswers,
} from "@/features/occurrences/draft-answers";

type DeliveryDraftKind = "delivery-proof" | "delivery-occurrence";

/** A file the draft owns, in the shape the upload takes. */
interface DraftFile {
  uri: string;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string | null;

  /** When the camera returned it (proof design §8.2); see UploadFile. */
  takenAt?: string;
}

interface ProofDraft {
  submissionId: string;
  photo: DraftFile | null;
  signature: DraftFile | null;
  receivedBy: string;

  /**
   * Decision 14.3: the delivery type chosen, its additional photos and its
   * form's answers. Optional: drafts written before the types have none.
   */
  typeId?: string | null;
  photos?: DraftFile[];
  answers?: DraftAnswers;
  description?: string;

  /**
   * Decision 14.2: the phone's pre-check of the receipt, bound to the photo
   * it read (features/ai-precheck). Optional, validated on restore.
   */
  precheck?: unknown;

  updatedAt: string;
}

interface OccurrenceDraft {
  submissionId: string;
  occurrenceTypeId: string;
  description: string;
  photo: DraftFile | null;

  /**
   * The form's answers as typed, by field key (decision 6.2). Optional:
   * drafts written before forms have none.
   */
  answers?: DraftAnswers;

  updatedAt: string;
}

/** Which draft a camera result belongs to, recorded before the camera opens. */
interface DeliveryCaptureTarget {
  kind: DeliveryDraftKind;
  businessId: string;
  deliveryId: string;
}

/**
 * `@trajetto:submission:<kind>:<userId>:<businessId>:<deliveryId>`.
 *
 * The same shape as the fuel and checklist keys, and that is what makes the
 * rest of the app treat these drafts like theirs: the logout deletes every
 * `@trajetto:submission:` key, and its warning counts the `:draft` ones of
 * the user signing out (`logout-rules.countOpenDrafts`).
 */
function deliveryDraftKey(
  kind: DeliveryDraftKind,
  userId: string,
  businessId: string,
  deliveryId: string,
): string {
  return `@trajetto:submission:${kind}:${userId}:${businessId}:${deliveryId}`;
}

/** The file, or null when it is gone — the screen then asks for it again. */
const keptFile = (
  file: DraftFile | null | undefined,
  exists: (uri: string) => boolean,
): DraftFile | null => (file && exists(file.uri) ? file : null);

/**
 * A stored proof, read back. Tolerant of fields a future build may add or an
 * older one never wrote: a draft is the driver's work, and a shape it does
 * not recognise must not cost them the parts it does.
 */
function reviveProofDraft(
  draft: Partial<ProofDraft>,
  exists: (uri: string) => boolean,
): ProofDraft | null {
  if (typeof draft.submissionId !== "string") return null;

  return {
    submissionId: draft.submissionId,
    photo: keptFile(draft.photo, exists),
    signature: keptFile(draft.signature, exists),
    receivedBy: typeof draft.receivedBy === "string" ? draft.receivedBy : "",
    typeId: typeof draft.typeId === "string" ? draft.typeId : null,
    photos: Array.isArray(draft.photos)
      ? draft.photos
          .map((file) => keptFile(file, exists))
          .filter((file): file is DraftFile => file !== null)
      : [],
    answers: reviveDraftAnswers(draft.answers),
    description: typeof draft.description === "string" ? draft.description : "",
    // Checked against the photo when restored: a stale one is never shown.
    precheck: draft.precheck,
    updatedAt: draft.updatedAt ?? new Date(0).toISOString(),
  };
}

function reviveOccurrenceDraft(
  draft: Partial<OccurrenceDraft>,
  exists: (uri: string) => boolean,
): OccurrenceDraft | null {
  if (typeof draft.submissionId !== "string") return null;

  return {
    submissionId: draft.submissionId,
    occurrenceTypeId:
      typeof draft.occurrenceTypeId === "string" ? draft.occurrenceTypeId : "",
    description: typeof draft.description === "string" ? draft.description : "",
    photo: keptFile(draft.photo, exists),
    answers: reviveDraftAnswers(draft.answers),
    updatedAt: draft.updatedAt ?? new Date(0).toISOString(),
  };
}

/**
 * The draft once a recovered camera photo is put in it. Whatever else the
 * driver had typed stays; the photo is the one they were taking.
 */
function withRecoveredPhoto(
  kind: DeliveryDraftKind,
  existing: ProofDraft | OccurrenceDraft | null,
  submissionId: string,
  photo: DraftFile,
  now: string,
): ProofDraft | OccurrenceDraft {
  if (kind === "delivery-proof") {
    const proof = existing as ProofDraft | null;

    return {
      submissionId,
      photo,
      signature: proof?.signature ?? null,
      receivedBy: proof?.receivedBy ?? "",
      typeId: proof?.typeId ?? null,
      photos: proof?.photos ?? [],
      answers: proof?.answers,
      description: proof?.description ?? "",
      updatedAt: now,
    };
  }

  const occurrence = existing as OccurrenceDraft | null;

  return {
    submissionId,
    photo,
    occurrenceTypeId: occurrence?.occurrenceTypeId ?? "",
    description: occurrence?.description ?? "",
    answers: occurrence?.answers ?? {},
    updatedAt: now,
  };
}

/** The screen a recovered photo belongs to. */
function screenOfTarget(
  target: DeliveryCaptureTarget,
): "/delivery-proof" | "/delivery-occurrence" {
  return target.kind === "delivery-proof"
    ? "/delivery-proof"
    : "/delivery-occurrence";
}

export {
  deliveryDraftKey,
  reviveOccurrenceDraft,
  reviveProofDraft,
  screenOfTarget,
  withRecoveredPhoto,
};

export type {
  DeliveryCaptureTarget,
  DeliveryDraftKind,
  DraftFile,
  OccurrenceDraft,
  ProofDraft,
};
