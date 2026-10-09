import {
  deliveryOccurrenceBodySchema,
  type DeliveryOccurrenceBody,
} from "@/schemas/delivery";
import { normalizeMultilineText } from "@/schemas/text-rules";

import {
  occurrenceFormPart,
  type DraftAnswers,
  type TypeForm,
} from "./occurrence-form";

/**
 * The occurrence report's body, built in ONE place for the two roads that
 * make one: a new report from the screen, and a queued report the driver
 * revised after the form changed (contract §6).
 *
 * Parsed before anything is queued: a 400 on a queued item is a failure the
 * driver can only discard, so what the API would refuse never enters the
 * queue. The parsed value is what is sent — normalized, empty optionals out.
 */

interface OccurrenceBodyInput {
  submissionId: string;
  occurrenceTypeId: string;

  /** The tap, frozen: a report sent hours later still says when it happened. */
  occurredAt: string;

  description?: string;
  coordinates?: { latitude: number; longitude: number } | null;

  form: TypeForm;
  answers: DraftAnswers;
}

function buildOccurrenceBody(input: OccurrenceBodyInput): DeliveryOccurrenceBody {
  // First, and with its own error: the screen marks each field.
  const formPart = occurrenceFormPart(input.form, input.answers);

  const parsed = deliveryOccurrenceBodySchema.safeParse({
    client_submission_id: input.submissionId,
    occurrenceTypeId: input.occurrenceTypeId,
    occurred_at: input.occurredAt,
    description: normalizeMultilineText(input.description ?? ""),
    ...(input.coordinates && {
      latitude: input.coordinates.latitude,
      longitude: input.coordinates.longitude,
    }),
    ...formPart,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  // An empty optional is left out rather than kept as an `undefined` key in
  // what the queue stores.
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined),
  ) as DeliveryOccurrenceBody;
}

interface QueuedReport {
  id: string;
  createdAt: string;
  body: Record<string, unknown>;
}

const numberOr = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * A queued report with what the driver changed in review. What happened at
 * the stop is kept as it was sent the first time: the same submission id
 * (the API records it once), the moment of the tap and the place.
 */
function revisedOccurrenceBody(
  item: QueuedReport,
  change: {
    occurrenceTypeId: string;
    description?: string;
    form: TypeForm;
    answers: DraftAnswers;
  },
): DeliveryOccurrenceBody {
  const { body } = item;

  const submissionId =
    typeof body.client_submission_id === "string"
      ? body.client_submission_id
      : item.id;

  const occurredAt =
    typeof body.occurred_at === "string" ? body.occurred_at : item.createdAt;

  const latitude = numberOr(body.latitude);
  const longitude = numberOr(body.longitude);

  return buildOccurrenceBody({
    submissionId,
    occurrenceTypeId: change.occurrenceTypeId,
    occurredAt,
    description: change.description,
    coordinates:
      latitude !== undefined && longitude !== undefined
        ? { latitude, longitude }
        : null,
    form: change.form,
    answers: change.answers,
  });
}

export { buildOccurrenceBody, revisedOccurrenceBody };
export type { OccurrenceBodyInput, QueuedReport };
