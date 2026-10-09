import { describe, expect, it } from "vitest";

import {
  DELIVERED_REVIEW_COPY,
  REVIEW_COPY,
  occurrenceTargetOf,
  refusalReaction,
  reviewEntryOf,
} from "@/features/occurrences/occurrence-queue-rules";

/**
 * Edges of the occurrence review rules left alive by the 06/10 mutation run:
 * no company to compare, codes that are not text, URLs with a prefix, and
 * the exact words of every review.
 */

const refused = (businessId?: string) => ({
  kind: "delivery-occurrence",
  status: "failed",
  failureCode: "OCCURRENCE_FORM_OUTDATED",
  businessId,
});

describe("reviewEntryOf without a company to compare", () => {
  it("blocks the review when neither side names a company", () => {
    expect(reviewEntryOf(refused(undefined), undefined)).toBe("other-company");
  });

  it("blocks the review when both sides are an empty id", () => {
    expect(reviewEntryOf(refused(""), "")).toBe("other-company");
  });
});

describe("refusalReaction", () => {
  it("reads only object errors", () => {
    const fn = Object.assign(() => undefined, { code: "OCCURRENCE_TYPE_INACTIVE" });

    expect(refusalReaction(fn)).toBeNull();
  });

  it("reads only text codes", () => {
    // An array would stringify to a known key if it were used as one.
    expect(refusalReaction({ code: ["CLIENT_OUTDATED"] })).toBeNull();
    expect(refusalReaction({ code: "CLIENT_OUTDATED" })).toBe("form-unanswered");
  });
});

describe("occurrenceTargetOf", () => {
  it("only reads a report URL from its start", () => {
    expect(occurrenceTargetOf("/v2/delivery/report-occurrence/d1/business/b1")).toBeNull();
    expect(occurrenceTargetOf("/delivery/report-occurrence/d1/business/b1")).toEqual({
      deliveryId: "d1",
      businessId: "b1",
    });
  });
});

describe("review copy", () => {
  it("says each occurrence review in the driver's words", () => {
    expect(REVIEW_COPY).toEqual({
      "form-outdated": {
        message:
          "O formulário deste tipo de ocorrência mudou. Revise as respostas e envie de novo: o que você já preencheu foi mantido.",
        actionLabel: "Revisar formulário",
      },
      "form-unanswered": {
        message: "Este tipo de ocorrência agora tem perguntas. Responda o formulário para enviar o registro.",
        actionLabel: "Responder formulário",
      },
      "form-invalid": {
        message:
          "A empresa recusou as respostas do formulário. Corrija os campos indicados e envie de novo.",
        actionLabel: "Revisar formulário",
      },
      "type-unavailable": {
        message:
          "Este tipo de ocorrência foi desativado pela empresa. Escolha outro tipo para enviar o registro.",
        actionLabel: "Escolher outro tipo",
      },
    });
  });

  it("says each delivery review keeping what was collected", () => {
    expect(DELIVERED_REVIEW_COPY).toEqual({
      "form-outdated": {
        message:
          "O formulário deste tipo de entrega mudou. Revise as respostas e envie de novo: o canhoto, a assinatura e as fotos foram mantidos.",
        actionLabel: "Revisar entrega",
      },
      "form-unanswered": {
        message:
          "Este tipo de entrega agora tem perguntas. Responda o formulário para enviar a entrega: o canhoto e a assinatura foram mantidos.",
        actionLabel: "Responder formulário",
      },
      "form-invalid": {
        message:
          "A empresa recusou as respostas do formulário da entrega. Corrija os campos indicados e envie de novo: o canhoto e a assinatura foram mantidos.",
        actionLabel: "Revisar entrega",
      },
      "type-unavailable": {
        message:
          "Este tipo de entrega foi desativado pela empresa. Escolha outro tipo para enviar a entrega: o canhoto e a assinatura foram mantidos.",
        actionLabel: "Escolher outro tipo",
      },
    });
  });
});
