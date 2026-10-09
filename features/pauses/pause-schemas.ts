import { z } from "zod";

import {
  PAUSE_KINDS,
  PAUSE_NOTE_MAX_LENGTH,
  normalizePauseNote,
} from "./pause-rules";

/**
 * What the pause gestures may send, mirrored from the API
 * (`trajetto-api/src/modules/driver-pause/schemas/driver-pause-schemas.ts`).
 *
 * Parsed BEFORE the gesture reaches `submitOrQueue`: a 400 on a queued item
 * is a failure the driver can only discard, so what the API would refuse
 * never enters the queue. The note is cleaned like the API cleans it, so the
 * only refusal left is a real excess.
 */

const kindField = z.enum(PAUSE_KINDS, {
  errorMap: () => ({ message: "Tipo de pausa inválido. Use MEAL, REST ou OTHER." }),
});

const submissionKey = (what: string) =>
  z
    .string({ required_error: `A chave do envio (${what}) é obrigatória.` })
    .uuid(`A chave do envio (${what}) é inválida.`);

// The app stamps `toISOString()` (the tap) or repeats the server's instant.
const occurredAtField = z.string().datetime("O horário do registro é inválido.");

const latitudeField = z
  .number({ invalid_type_error: "A latitude é inválida." })
  .min(-90, "A latitude é inválida.")
  .max(90, "A latitude é inválida.");

const longitudeField = z
  .number({ invalid_type_error: "A longitude é inválida." })
  .min(-180, "A longitude é inválida.")
  .max(180, "A longitude é inválida.");

const noteField = z
  .string()
  .nullish()
  .transform((value) => normalizePauseNote(value))
  .refine((value) => value === null || value.length <= PAUSE_NOTE_MAX_LENGTH, {
    message: `A observação deve ter no máximo ${PAUSE_NOTE_MAX_LENGTH} caracteres.`,
  })
  // An empty note is left out of the body, as the API reads it (null).
  .transform((value) => value ?? undefined);

/** Decision 14.4 (contract 3): the company's pause type chosen. */
const occurrenceTypeIdField = z.string().uuid("O tipo de pausa é inválido.").optional();

/** `POST /driver-pause/start/:businessId` */
const startPauseBodySchema = z.object({
  kind: kindField,
  occurrence_type_id: occurrenceTypeIdField,
  start_submission_id: submissionKey("início"),
  occurred_at: occurredAtField,
  latitude: latitudeField.optional(),
  longitude: longitudeField.optional(),
  note: noteField,
});

/** `POST /driver-pause/end/:businessId`, with the start repeated. */
const endPauseBodySchema = z.object({
  start_submission_id: submissionKey("início"),
  end_submission_id: submissionKey("fim"),
  occurred_at: occurredAtField,
  latitude: latitudeField.optional(),
  longitude: longitudeField.optional(),
  start: z.object({
    kind: kindField,
    occurrence_type_id: occurrenceTypeIdField,
    occurred_at: occurredAtField,
    latitude: latitudeField.optional(),
    longitude: longitudeField.optional(),
    note: noteField,
  }),
});

/** What the start screen validates while the driver types. */
const pauseNoteFormSchema = z.object({ note: noteField });

/**
 * The body as it goes out, or the reason the API would refuse it. Empty
 * optionals are dropped rather than kept as `undefined` keys in the queue.
 */
function parsePauseBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): Record<string, unknown> {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  return JSON.parse(JSON.stringify(parsed.data)) as Record<string, unknown>;
}

export {
  endPauseBodySchema,
  parsePauseBody,
  pauseNoteFormSchema,
  startPauseBodySchema,
};
