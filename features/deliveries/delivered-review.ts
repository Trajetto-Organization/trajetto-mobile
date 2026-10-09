import { reviseOutboxItem, type OutboxItem } from "@/features/submissions/outbox";

import { OTHER_COMPANY_REVIEW } from "@/features/occurrences/occurrence-queue-rules";
import type { DraftAnswers } from "@/features/occurrences/draft-answers";

import { revisedDeliveredBody } from "./delivered-review-rules";
import type { DriverOccurrenceType } from "./types";

/**
 * A queued delivery proof answered again by the driver, back in line
 * (decision 14.3; design §8.3), like `reviseQueuedOccurrence`: the body is
 * rebuilt and checked like a new proof, the files are the item's own (their
 * uploads, if any, are kept), and the queue sends it at once.
 *
 * Throws `OccurrenceFormError` (the screen marks the fields) or a plain
 * `Error` when the body is refused; resolves false when the item is no
 * longer there to revise (sent, discarded, or not this driver's).
 */
async function reviseQueuedDelivered(
  item: Pick<OutboxItem, "id" | "createdAt" | "body" | "businessId" | "photos">,
  change: {
    /** The company whose catalog the type was read from: the item's own. */
    businessId: string;
    type: DriverOccurrenceType;
    answers: DraftAnswers;
    receivedBy?: string;
    description?: string;
  },
): Promise<boolean> {
  if (change.businessId !== item.businessId) throw new Error(OTHER_COMPANY_REVIEW);

  const body = revisedDeliveredBody(item, change);

  return reviseOutboxItem(item.id, body);
}

export { reviseQueuedDelivered };
