import { reviseOutboxItem, type OutboxItem } from "@/features/submissions/outbox";

import { revisedOccurrenceBody } from "./occurrence-payload";
import { OTHER_COMPANY_REVIEW } from "./occurrence-queue-rules";
import type { DraftAnswers, TypeForm } from "./occurrence-form";

/**
 * A queued occurrence answered again by the driver, back in line (contract
 * §6: a form that changed, a build before forms, a type switched off).
 *
 * The body is rebuilt and checked like a new report — nothing the API would
 * refuse goes back into the queue — while what happened at the stop stays as
 * it was: the same submission id, the moment and the place. The queue then
 * sends it at once, photos and their uploads included.
 *
 * Throws `OccurrenceFormError` (the screen marks the fields) or a plain
 * `Error` when the body is refused; resolves false when the item is no
 * longer there to revise (sent, discarded, or not this driver's).
 */
async function reviseQueuedOccurrence(
  item: Pick<OutboxItem, "id" | "createdAt" | "body" | "businessId">,
  change: {
    /**
     * The company whose catalog the type and form were read from. Must be
     * the report's own: the screen reads the company selected now, and
     * another's type id would be refused for good (404), never fixed.
     */
    businessId: string;
    occurrenceTypeId: string;
    description?: string;
    form: TypeForm;
    answers: DraftAnswers;
  },
): Promise<boolean> {
  if (change.businessId !== item.businessId) throw new Error(OTHER_COMPANY_REVIEW);

  const body = revisedOccurrenceBody(item, change);

  return reviseOutboxItem(item.id, body);
}

export { reviseQueuedOccurrence };
