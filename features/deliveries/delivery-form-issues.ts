/**
 * What the proof of delivery and the occurrence screens validate live
 * (decision 16.700), as one map of messages per field in screen order. Pure:
 * the screens only show it and bring the first invalid field into view.
 *
 * The company's form fields keep their own keys (lowercase slugs); the
 * screen's own fields start with "@", a character a slug can never hold, so
 * a question called "description" or "photo" never collides with them.
 */

import type { MissingRequirement } from "./occurrence-category-rules";

const SCREEN_FIELDS = {
  type: "@type",
  description: "@description",
  photo: "@photo",
  receipt: "@receipt",
  signature: "@signature",
  photos: "@photos",
  receivedBy: "@receivedBy",
} as const;

const OCCURRENCE_TYPE_REQUIRED = "Selecione o tipo de ocorrência.";

// The hint above the area already says the type asks for a photo; the
// message says what to do.
const OCCURRENCE_PHOTO_MISSING = "Adicione a foto da ocorrência.";

type Issues = Record<string, string | null>;

/** The occurrence report: type, the company's questions, description, photo. */
function occurrenceScreenIssues({
  hasType,
  formErrors,
  descriptionError,
  missingPhoto,
}: {
  hasType: boolean;
  formErrors: Readonly<Record<string, string>>;
  descriptionError: string | null | undefined;
  missingPhoto: boolean;
}): Issues {
  return {
    [SCREEN_FIELDS.type]: hasType ? null : OCCURRENCE_TYPE_REQUIRED,
    ...formErrors,
    [SCREEN_FIELDS.description]: descriptionError ?? null,
    [SCREEN_FIELDS.photo]: missingPhoto ? OCCURRENCE_PHOTO_MISSING : null,
  };
}

function occurrenceScreenOrder(fields: ReadonlyArray<{ key: string }> | null | undefined): string[] {
  return [
    SCREEN_FIELDS.type,
    ...(fields ?? []).map((field) => field.key),
    SCREEN_FIELDS.description,
    SCREEN_FIELDS.photo,
  ];
}

/** Which proof section each of the API's missing requirements belongs to. */
const REQUIREMENT_FIELD: Record<MissingRequirement["code"], string> = {
  OCCURRENCE_RECEIPT_PHOTO_REQUIRED: SCREEN_FIELDS.receipt,
  OCCURRENCE_SIGNATURE_REQUIRED: SCREEN_FIELDS.signature,
  OCCURRENCE_PHOTO_REQUIRED: SCREEN_FIELDS.photos,
};

/**
 * The proof of delivery: each missing file under its own section (instead of
 * one line at the bottom), "Quem recebeu" and the company's questions.
 */
function proofScreenIssues({
  missing,
  receivedByError,
  formErrors,
}: {
  missing: readonly MissingRequirement[];
  receivedByError: string | null | undefined;
  formErrors: Readonly<Record<string, string>>;
}): Issues {
  const issues: Issues = {
    [SCREEN_FIELDS.receipt]: null,
    [SCREEN_FIELDS.signature]: null,
    [SCREEN_FIELDS.photos]: null,
  };

  for (const requirement of missing) {
    const field = REQUIREMENT_FIELD[requirement.code];
    if (!issues[field]) issues[field] = requirement.message;
  }

  return {
    ...issues,
    [SCREEN_FIELDS.receivedBy]: receivedByError ?? null,
    ...formErrors,
  };
}

function proofScreenOrder(fields: ReadonlyArray<{ key: string }> | null | undefined): string[] {
  return [
    SCREEN_FIELDS.receipt,
    SCREEN_FIELDS.signature,
    SCREEN_FIELDS.photos,
    SCREEN_FIELDS.receivedBy,
    ...(fields ?? []).map((field) => field.key),
  ];
}

export {
  OCCURRENCE_PHOTO_MISSING,
  OCCURRENCE_TYPE_REQUIRED,
  SCREEN_FIELDS,
  occurrenceScreenIssues,
  occurrenceScreenOrder,
  proofScreenIssues,
  proofScreenOrder,
};
