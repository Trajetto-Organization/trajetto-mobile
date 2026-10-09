import { z } from "zod";

import { devicePrecheckSchema } from "./device-precheck";

import { hasConsecutiveSpaces, hasSpaceAtEdges } from "@/utils/formatters";

import { hasInlineConsecutiveSpaces, hasSpaceAtLineEdges } from "./text-rules";

/**
 * What the driver's delivery actions may send, mirrored from the API.
 *
 * These sit in front of the offline queue. An arrival, a proof or an
 * occurrence recorded in a basement is sent hours later, and a 400 then is a
 * permanent failure the driver can only discard — a proof of delivery lost to
 * a double space (DLV-ST-2, DLVP-OCC-2). So the body is parsed HERE, with the
 * API's own limits and messages, before it can be queued.
 *
 * Sources, kept in step by hand:
 * - `trajetto-api/src/schemas/delivery-arrival-schema`
 * - `trajetto-api/src/schemas/delivery-proof-schema`
 * - `trajetto-api/src/schemas/report-delivery-occurrence-schema`
 */

const RECEIVED_BY_MAX_LENGTH = 150;
const OCCURRENCE_DESCRIPTION_MAX_LENGTH = 500;

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

/**
 * "Quem recebeu": optional in the app (decision 5.3 — the photo and the
 * signature carry the proof), single line, the API's text rules.
 */
const receivedByField = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .max(
      RECEIVED_BY_MAX_LENGTH,
      "O nome de quem recebeu deve ter no máximo 150 caracteres.",
    )
    .superRefine((value, ctx) => {
      if (hasConsecutiveSpaces(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "O nome de quem recebeu não deve conter espaços consecutivos.",
        });

        return;
      }

      if (hasSpaceAtEdges(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "O nome de quem recebeu não pode começar ou terminar com espaço em branco.",
        });
      }
    })
    .optional(),
);

/**
 * The occurrence description: optional and multiline, so line breaks may
 * repeat (decision 5.5) while spaces may not.
 */
const occurrenceDescriptionField = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .max(
      OCCURRENCE_DESCRIPTION_MAX_LENGTH,
      "A descrição deve ter no máximo 500 caracteres.",
    )
    .superRefine((value, ctx) => {
      if (hasInlineConsecutiveSpaces(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A descrição não deve conter espaços consecutivos.",
        });

        return;
      }

      if (hasSpaceAtEdges(value) || hasSpaceAtLineEdges(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "A descrição não pode começar ou terminar com espaço em branco.",
        });
      }
    })
    .optional(),
);

const occurrenceTypeIdField = z
  .string({ required_error: "O tipo de ocorrência é obrigatório." })
  .min(1, "O tipo de ocorrência é obrigatório.");

const clientSubmissionIdField = z
  .string({ required_error: "A chave de idempotência do envio é obrigatória." })
  .uuid("A chave de idempotência do envio é inválida.");

// The app always stamps `toISOString()`; anything else is a bug, not a
// timestamp the API should be left to ignore.
const occurredAtField = z.string().datetime("O horário do registro é inválido.");

// `z.number()` refuses NaN, which JSON would carry as null — a 400 later.
const latitudeField = z
  .number({ invalid_type_error: "A latitude é inválida." })
  .min(-90, "A latitude é inválida.")
  .max(90, "A latitude é inválida.");

const longitudeField = z
  .number({ invalid_type_error: "A longitude é inválida." })
  .min(-180, "A longitude é inválida.")
  .max(180, "A longitude é inválida.");

/**
 * Proof design §7.2: the phone that recorded the proof (16 hex Android ID or
 * an installation UUID) and when its receipt photo was taken. Optional and
 * informative: the API nulls a shape it does not keep, never refuses.
 */
const deviceIdField = z
  .string()
  .regex(
    /^(?:[0-9a-f]{16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    "A identificação do aparelho é inválida.",
  );

const photoTakenAtField = z.string().datetime("O horário da foto é inválido.");

/** `POST /delivery/arrival/:deliveryId/business/:businessId` */
const deliveryArrivalBodySchema = z.object({
  client_submission_id: clientSubmissionIdField,
  latitude: latitudeField,
  longitude: longitudeField,
  occurred_at: occurredAtField,
});

/**
 * `POST /delivery/proof/:deliveryId/business/:businessId`, before the photo
 * keys are added: the photo and the signature are files until the upload,
 * and `submitOrQueue` puts their keys in the body.
 */
const deliveryProofBodySchema = z.object({
  client_submission_id: clientSubmissionIdField,
  occurred_at: occurredAtField,
  received_by: receivedByField,
  latitude: latitudeField.optional(),
  longitude: longitudeField.optional(),
  // Decision 14.2: the phone's offline check of the receipt photo.
  device_precheck: devicePrecheckSchema.optional(),
  photo_taken_at: photoTakenAtField.optional(),
  device_id: deviceIdField.optional(),
});

/**
 * The form's answers (decision 6.2), the API's shape: key → primitive. What
 * they must say is checked against the type's form before this
 * (`features/occurrences/occurrence-form`); this only keeps the body honest.
 */
const occurrenceFormAnswersField = z
  .record(
    z.string().max(40),
    z.union([z.string().max(1000), z.number().finite(), z.boolean()]),
  )
  .refine((answers) => Object.keys(answers).length <= 50, {
    message: "Respostas demais para um formulário de ocorrência.",
  });

/**
 * The version of the form the phone showed. Required: every build that
 * renders forms sends it, form or not, and a report without it is read by the
 * API as coming from a build that cannot show forms (contract §7).
 */
const occurrenceFormVersionField = z
  .number({ required_error: "A versão do formulário da ocorrência é obrigatória." })
  .int("A versão do formulário da ocorrência é inválida.")
  .positive("A versão do formulário da ocorrência é inválida.");

/** `POST /delivery/report-occurrence/:deliveryId/business/:businessId`, likewise. */
const deliveryOccurrenceBodySchema = z.object({
  client_submission_id: clientSubmissionIdField,
  occurrenceTypeId: occurrenceTypeIdField,
  occurred_at: occurredAtField,
  description: occurrenceDescriptionField,
  latitude: latitudeField.optional(),
  longitude: longitudeField.optional(),
  form_answers: occurrenceFormAnswersField.optional(),
  form_version: occurrenceFormVersionField,
});

/**
 * A DELIVERED occurrence (decision 14.3): the report's body plus who
 * received it. The receipt and the signature are storage keys the queue adds
 * at send time (photoField "occurrence-files").
 */
const deliveredOccurrenceBodySchema = deliveryOccurrenceBodySchema.extend({
  received_by: receivedByField,
  // Decision 14.2: the phone's offline check of the receipt photo.
  device_precheck: devicePrecheckSchema.optional(),
  photo_taken_at: photoTakenAtField.optional(),
  device_id: deviceIdField.optional(),
});

/** What the proof screen validates while the driver types. */
const deliveryProofFormSchema = z.object({
  receivedBy: receivedByField,
});

/** What the occurrence screen validates while the driver types. */
const deliveryOccurrenceFormSchema = z.object({
  occurrenceTypeId: occurrenceTypeIdField,
  description: occurrenceDescriptionField,
});

type DeliveryArrivalBody = z.infer<typeof deliveryArrivalBodySchema>;
type DeliveryProofBody = z.infer<typeof deliveryProofBodySchema>;
type DeliveryOccurrenceBody = z.infer<typeof deliveryOccurrenceBodySchema>;
type DeliveredOccurrenceBody = z.infer<typeof deliveredOccurrenceBodySchema>;

export {
  OCCURRENCE_DESCRIPTION_MAX_LENGTH,
  RECEIVED_BY_MAX_LENGTH,
  deliveryArrivalBodySchema,
  deliveredOccurrenceBodySchema,
  deliveryOccurrenceBodySchema,
  deliveryOccurrenceFormSchema,
  deliveryProofBodySchema,
  deliveryProofFormSchema,
};

export type {
  DeliveredOccurrenceBody,
  DeliveryArrivalBody,
  DeliveryOccurrenceBody,
  DeliveryProofBody,
};
