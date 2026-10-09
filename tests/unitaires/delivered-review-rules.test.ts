import { describe, expect, it } from "vitest";

import { describePendingItem } from "@/features/submissions/pending-item-rules";
import { OccurrenceFormError } from "@/features/occurrences/occurrence-form";
import {
  DELIVERED_REVIEW_COPY,
  occurrenceReviewOf,
  reviewEntryOf,
  reviewRouteOf,
} from "@/features/occurrences/occurrence-queue-rules";
import {
  queuedDeliveredFiles,
  queuedDeliveredTexts,
  revisedDeliveredBody,
} from "@/features/deliveries/delivered-review-rules";

import type { DriverOccurrenceType } from "@/features/deliveries/types";

/**
 * A queued delivery proof (`delivery-delivered`, decision 14.3) refused over
 * its form or its type (design §8.3). Before, it fell in the generic "failed"
 * branch: "Tentar de novo" met the same refusal, and discarding threw away the
 * receipt and the signature after the customer had left. Now it waits for the
 * driver's review on the proof screen, with what was collected kept.
 */

const NOW = Date.parse("2026-10-05T12:00:00Z");

const SUBMISSION = "0192a000-0000-7000-8000-0000000000a1";
const DELIVERY = "0192a000-0000-7000-8000-0000000000d1";
const TYPE = "0192a000-0000-7000-8000-0000000000e1";
const OTHER_TYPE = "0192a000-0000-7000-8000-0000000000e2";

const refusedProof = (overrides: Record<string, unknown> = {}) => ({
  id: SUBMISSION,
  kind: "delivery-delivered",
  businessId: "business-a",
  endpoint: `/delivery/report-occurrence/${DELIVERY}/business/business-a`,
  createdAt: new Date(NOW - 60_000).toISOString(),
  status: "failed" as const,
  attempts: 1,
  failure: "permanent",
  failureCode: "OCCURRENCE_FORM_OUTDATED",
  ...overrides,
});

const deliveredType = (overrides: Partial<DriverOccurrenceType> = {}): DriverOccurrenceType =>
  ({
    id: TYPE,
    name: "Entrega normal",
    description: null,
    blocks_delivery: false,
    requires_photo: false,
    category: "DELIVERED",
    requires_receipt_photo: true,
    requires_signature: false,
    requires_authorization: false,
    form_fields: null,
    form_version: 1,
    is_default: true,
    ...overrides,
  }) as DriverOccurrenceType;

describe("a delivery proof refused over its form or its type", () => {
  it.each([
    ["OCCURRENCE_FORM_OUTDATED", "form-outdated"],
    ["OCCURRENCE_FORM_INVALID", "form-invalid"],
    ["OCCURRENCE_TYPE_INACTIVE", "type-unavailable"],
  ] as const)("%s waits for the driver's review, not a retry", (code, reason) => {
    const item = refusedProof({ failureCode: code });

    expect(occurrenceReviewOf(item)).toEqual({ reason, ...DELIVERED_REVIEW_COPY[reason] });

    const view = describePendingItem(item, "own", NOW, { businessId: "business-a" });

    expect(view.retryLabel).toBeNull();
    expect(view.reviewLabel).toBe(DELIVERED_REVIEW_COPY[reason].actionLabel);
    expect(view.message).toContain("canhoto");
    expect(view.canDiscard).toBe(true);
  });

  it("reopens on the proof screen, not on the occurrence one", () => {
    expect(reviewRouteOf(refusedProof())).toEqual({
      pathname: "/delivery-proof",
      params: { id: DELIVERY, review: SUBMISSION },
    });

    expect(
      reviewRouteOf(refusedProof({ kind: "delivery-occurrence" }))?.pathname,
    ).toBe("/delivery-occurrence");
  });

  it("keeps the generic failure for refusals a review cannot fix", () => {
    const item = refusedProof({ failureCode: "INVALID_STATUS_TRANSITION" });

    expect(occurrenceReviewOf(item)).toBeNull();
    expect(reviewRouteOf(item)).toBeNull();
    expect(describePendingItem(item, "own", NOW, { businessId: "business-a" }).retryLabel).toBe(
      "Tentar de novo",
    );
  });

  it("is reviewed only under its own company", () => {
    expect(reviewEntryOf(refusedProof(), "business-a")).toBe("open");
    expect(reviewEntryOf(refusedProof(), "business-b")).toBe("other-company");
  });

  it("leaves the installed app's legacy proof kind as it was", () => {
    expect(occurrenceReviewOf(refusedProof({ kind: "delivery-proof" }))).toBeNull();
  });
});

describe("the revised body", () => {
  const queued = {
    id: SUBMISSION,
    createdAt: new Date(NOW - 60_000).toISOString(),
    body: {
      client_submission_id: SUBMISSION,
      occurrenceTypeId: TYPE,
      occurred_at: "2026-10-05T11:58:00.000Z",
      description: "Portão lateral",
      received_by: "Maria",
      latitude: -23.5,
      longitude: -46.6,
      form_version: 1,
    },
    photos: [{ fieldName: "receipt_photo" }, { fieldName: "photos" }],
  };

  it("reads what the queued item carries", () => {
    expect(queuedDeliveredFiles(queued.photos)).toEqual({
      receiptPhoto: true,
      signature: false,
      photos: 1,
    });
    expect(queuedDeliveredTexts(queued.body)).toEqual({
      typeId: TYPE,
      receivedBy: "Maria",
      description: "Portão lateral",
    });
  });

  it("keeps the submission, the moment and the place; takes the new type and answers", () => {
    const type = deliveredType({
      id: OTHER_TYPE,
      form_fields: [{ key: "conferido", label: "Conferido", type: "boolean", required: true }],
      form_version: 3,
    } as Partial<DriverOccurrenceType>);

    expect(revisedDeliveredBody(queued, { type, answers: { conferido: true } })).toEqual({
      client_submission_id: SUBMISSION,
      occurrenceTypeId: OTHER_TYPE,
      occurred_at: "2026-10-05T11:58:00.000Z",
      description: "Portão lateral",
      received_by: "Maria",
      latitude: -23.5,
      longitude: -46.6,
      form_answers: { conferido: true },
      form_version: 3,
    });
  });

  it("keeps the capture's phone and photo instant (proof design §8.3)", () => {
    const withOrigin = {
      ...queued,
      body: {
        ...queued.body,
        photo_taken_at: "2026-10-05T11:57:40.000Z",
        device_id: "23be03c084165505",
      },
    };

    expect(revisedDeliveredBody(withOrigin, { type: deliveredType(), answers: {} })).toMatchObject({
      photo_taken_at: "2026-10-05T11:57:40.000Z",
      device_id: "23be03c084165505",
    });
  });

  it("refuses a type that asks for what was never collected", () => {
    expect(() =>
      revisedDeliveredBody(queued, { type: deliveredType({ requires_signature: true }), answers: {} }),
    ).toThrow(/assinatura/i);
  });

  it("refuses answers the form refuses, marked per field", () => {
    const type = deliveredType({
      form_fields: [{ key: "conferido", label: "Conferido", type: "boolean", required: true }],
    } as Partial<DriverOccurrenceType>);

    expect(() => revisedDeliveredBody(queued, { type, answers: {} })).toThrow(OccurrenceFormError);
  });
});
