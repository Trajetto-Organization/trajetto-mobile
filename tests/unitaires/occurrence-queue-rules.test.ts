import { describe, expect, it } from "vitest";

import { ApiError } from "@/utils/api-error";
import { describePendingItem } from "@/features/submissions/pending-item-rules";
import { OccurrenceFormError } from "@/features/occurrences/occurrence-form";
import {
  OTHER_COMPANY_REVIEW,
  REVIEW_COPY,
  occurrenceTargetOf,
  refusalReaction,
  refusalScreenChange,
  reviewAccessOf,
  reviewEntryOf,
  reviewFormState,
} from "@/features/occurrences/occurrence-queue-rules";

/**
 * The pure rules behind reopening an occurrence the API refused over its
 * form (contract §3 and §6): who may review it, what the screen does with a
 * refusal at the tap, and what the form says while the current version is
 * being fetched.
 *
 * The review screen reads the occurrence types of the company selected NOW.
 * Before, a report of company A reviewed while B was selected paired A's
 * report with B's catalog: the driver could pick one of B's types, and the
 * resend met 404 OCCURRENCE_TYPE_NOT_FOUND — a refusal no review can fix.
 */

const NOW = Date.parse("2026-09-29T12:00:00Z");

const refusedItem = (overrides: Record<string, unknown> = {}) => ({
  kind: "delivery-occurrence",
  businessId: "business-a",
  createdAt: new Date(NOW - 60_000).toISOString(),
  status: "failed" as const,
  attempts: 1,
  failure: "permanent",
  failureCode: "OCCURRENCE_FORM_OUTDATED",
  ...overrides,
});

describe("who may review a refused report", () => {
  it("the company it was filed for, selected now", () => {
    expect(reviewAccessOf(refusedItem(), "business-a")).toEqual({
      state: "here",
      review: { reason: "form-outdated", ...REVIEW_COPY["form-outdated"] },
    });
  });

  it("not while another company is selected: its catalog is not this report's", () => {
    expect(reviewAccessOf(refusedItem(), "business-b")).toEqual({
      state: "other-company",
      review: { reason: "form-outdated", ...REVIEW_COPY["form-outdated"] },
    });

    expect(reviewAccessOf(refusedItem({ failureCode: "OCCURRENCE_TYPE_INACTIVE" }), "business-b"))
      .toMatchObject({ state: "other-company" });
  });

  it("not without a company to compare, nor for an item that names none", () => {
    expect(reviewAccessOf(refusedItem(), null).state).toBe("other-company");
    expect(reviewAccessOf(refusedItem(), "").state).toBe("other-company");
    expect(reviewAccessOf(refusedItem({ businessId: undefined }), "business-a").state).toBe(
      "other-company",
    );
  });

  it("nothing to review on a plain failure, whatever the company", () => {
    expect(reviewAccessOf(refusedItem({ failureCode: "DELIVERY_NOT_FOUND" }), "business-a")).toEqual({
      state: "none",
    });
    expect(reviewAccessOf(refusedItem({ status: "pending" }), "business-b")).toEqual({ state: "none" });
  });
});

// Before: "Troque para ela para revisar." — only a MASTER switches company
// in the app, and the occurrence flow is a driver's: the driver was told to
// do something the app does not let them do.
describe("what the driver is told about another company's report", () => {
  it("something a driver can do: discard it or ask the manager, never switch company", () => {
    expect(OTHER_COMPANY_REVIEW).toBe(
      "Este envio é de outra empresa e não pode ser revisado neste acesso: descarte-o ou fale com o gestor.",
    );
    expect(OTHER_COMPANY_REVIEW).not.toMatch(/troque/i);
  });
});

// Before: the report screen blocked another company's item only while it
// still offered a review (failed with a form code). A deep link, or a
// back-navigation to an item already revised, showed the form with the
// catalog of the company selected now — a form that could only fail.
describe("what `review=<id>` opens", () => {
  it("the form, for a refused report of the company selected now", () => {
    expect(reviewEntryOf(refusedItem(), "business-a")).toBe("open");
  });

  it("never the form for another company's report, whatever its state", () => {
    expect(reviewEntryOf(refusedItem(), "business-b")).toBe("other-company");
    expect(reviewEntryOf(refusedItem({ status: "pending", failureCode: undefined }), "business-b")).toBe(
      "other-company",
    );
    expect(reviewEntryOf(refusedItem({ failureCode: "DELIVERY_NOT_FOUND" }), "business-b")).toBe(
      "other-company",
    );
    expect(reviewEntryOf(refusedItem(), "")).toBe("other-company");
    expect(reviewEntryOf(refusedItem({ businessId: undefined }), "business-a")).toBe(
      "other-company",
    );
  });

  it("no form for a report with nothing to review: already revised, or refused otherwise", () => {
    expect(reviewEntryOf(refusedItem({ status: "pending", failureCode: undefined }), "business-a")).toBe(
      "no-review",
    );
    expect(reviewEntryOf(refusedItem({ failureCode: "DELIVERY_NOT_FOUND" }), "business-a")).toBe(
      "no-review",
    );
  });

  it("nothing, for a report no longer on the phone", () => {
    expect(reviewEntryOf(null, "business-a")).toBe("gone");
  });
});

describe("the pending screen, for a driver of two companies", () => {
  it("offers the review only while the report's company is selected", () => {
    expect(
      describePendingItem(refusedItem(), "own", NOW, { businessId: "business-a" }),
    ).toMatchObject({ reviewLabel: "Revisar formulário", retryLabel: null, canDiscard: true });
  });

  it("an item of another company offers no review, and says how to get to it", () => {
    const view = describePendingItem(refusedItem(), "own", NOW, { businessId: "business-b" });

    expect(view.reviewLabel).toBeUndefined();
    expect(view).toMatchObject({
      tone: "warning",
      retryLabel: null,
      canDiscard: true,
      isExpired: false,
      message: `${REVIEW_COPY["form-outdated"].message} ${OTHER_COMPANY_REVIEW}`,
    });
  });

  it("a caller that does not say the company is never offered a review", () => {
    expect(describePendingItem(refusedItem(), "own", NOW).reviewLabel).toBeUndefined();
  });

  it("other kinds are untouched by the company", () => {
    expect(
      describePendingItem(
        refusedItem({ kind: "delivery-proof", lastError: "Recusado." }),
        "own",
        NOW,
        { businessId: "business-b" },
      ),
    ).toMatchObject({ tone: "danger", retryLabel: "Tentar de novo", message: "Recusado." });
  });
});

describe("what the report screen does with a refusal at the tap", () => {
  const apiRefusal = (code: string, status = 400) =>
    new ApiError("Recusado pela API.", status, "Refused", "HTTP", code);

  it("reads the API's codes the contract names", () => {
    expect(refusalReaction(apiRefusal("OCCURRENCE_FORM_OUTDATED", 409))).toBe("form-outdated");
    expect(refusalReaction(apiRefusal("CLIENT_OUTDATED"))).toBe("form-unanswered");
    expect(refusalReaction(apiRefusal("OCCURRENCE_FORM_INVALID"))).toBe("form-invalid");
    expect(refusalReaction(apiRefusal("OCCURRENCE_TYPE_INACTIVE"))).toBe("type-unavailable");
  });

  it("reads the phone's own form check as invalid answers", () => {
    expect(refusalReaction(new OccurrenceFormError({ volumes: "Preencha." }))).toBe("form-invalid");
  });

  it("has no reaction to anything else", () => {
    expect(refusalReaction(apiRefusal("DELIVERY_NOT_FOUND", 404))).toBeNull();
    expect(refusalReaction(new ApiError("Sem rede", 0, "Network Error", "NETWORK"))).toBeNull();
    expect(refusalReaction(new Error("boom"))).toBeNull();
    expect(refusalReaction("OCCURRENCE_FORM_OUTDATED")).toBeNull();
    expect(refusalReaction(null)).toBeNull();
    expect(refusalReaction(undefined)).toBeNull();
  });

  it("a changed form: fields marked, banner up, the current form fetched", () => {
    expect(refusalScreenChange(apiRefusal("OCCURRENCE_FORM_OUTDATED", 409))).toEqual({
      markFields: true,
      formChanged: true,
      clearType: false,
      refetch: true,
    });
  });

  it("a type switched off: cleared, so another is chosen", () => {
    expect(refusalScreenChange(apiRefusal("OCCURRENCE_TYPE_INACTIVE"))).toEqual({
      markFields: true,
      formChanged: false,
      clearType: true,
      refetch: true,
    });
  });

  it("answers the API refused, or a build before forms: the current form is fetched and marked", () => {
    for (const code of ["OCCURRENCE_FORM_INVALID", "CLIENT_OUTDATED"]) {
      expect(refusalScreenChange(apiRefusal(code))).toEqual({
        markFields: true,
        formChanged: false,
        clearType: false,
        refetch: true,
      });
    }
  });

  it("the phone's own check only marks the fields: its form is the one on screen", () => {
    expect(refusalScreenChange(new OccurrenceFormError({ volumes: "Preencha." }))).toEqual({
      markFields: true,
      formChanged: false,
      clearType: false,
      refetch: false,
    });
  });

  it("anything else changes nothing on screen (the toast already said it)", () => {
    expect(refusalScreenChange(apiRefusal("DELIVERY_NOT_FOUND", 404))).toBeNull();
    expect(refusalScreenChange(new Error("boom"))).toBeNull();
  });
});

describe("the queued report's delivery, from its URL", () => {
  it("reads the delivery and the company of a report", () => {
    expect(
      occurrenceTargetOf("/delivery/report-occurrence/delivery-1/business/business-a"),
    ).toEqual({ deliveryId: "delivery-1", businessId: "business-a" });
  });

  it("is not fooled by other endpoints", () => {
    expect(occurrenceTargetOf("/delivery/proof/delivery-1/business/business-a")).toBeNull();
    expect(occurrenceTargetOf("/delivery/report-occurrence/delivery-1")).toBeNull();
    expect(
      occurrenceTargetOf("/delivery/report-occurrence/delivery-1/business/business-a/extra"),
    ).toBeNull();
    expect(occurrenceTargetOf("")).toBeNull();
  });
});

describe("the form while the current version is fetched", () => {
  it("a queued review waits for the current form before sending, with its type held", () => {
    expect(
      reviewFormState({ reason: "form-outdated", typeListed: true, refresh: "loading" }),
    ).toEqual({ typeLocked: true, canSend: false, notice: "Buscando o formulário atual…" });
  });

  it("the type stays held while the list is still loading, even if it is not in it yet", () => {
    expect(
      reviewFormState({ reason: "form-outdated", typeListed: false, refresh: "loading" }),
    ).toMatchObject({ typeLocked: true, canSend: false });
  });

  it("once fetched, the review goes with the current form and the same type", () => {
    expect(
      reviewFormState({ reason: "form-outdated", typeListed: true, refresh: "done" }),
    ).toEqual({ typeLocked: true, canSend: true, notice: null });
  });

  it("a type that left the list after the fetch can be replaced, and the screen says why", () => {
    expect(
      reviewFormState({ reason: "form-outdated", typeListed: false, refresh: "done" }),
    ).toEqual({
      typeLocked: false,
      canSend: true,
      notice: "O tipo deste registro não está mais disponível. Escolha outro tipo.",
    });
  });

  it("a type switched off is never held", () => {
    expect(
      reviewFormState({ reason: "type-unavailable", typeListed: true, refresh: "done" }).typeLocked,
    ).toBe(false);
    expect(
      reviewFormState({ reason: "type-unavailable", typeListed: false, refresh: "loading" })
        .typeLocked,
    ).toBe(false);
  });

  it("without signal the driver may still send: a stale form comes back for review, never lost", () => {
    expect(
      reviewFormState({ reason: "form-outdated", typeListed: true, refresh: "failed" }),
    ).toEqual({
      typeLocked: true,
      canSend: true,
      notice:
        "Não foi possível buscar o formulário atual. Você pode enviar assim: se ele tiver mudado de novo, o registro volta para revisão.",
    });
  });

  // Before: without a network the fetch paused and the screen said
  // "Buscando…" with the send disabled until signal came back (the real
  // path is in occurrence-form-refresh.test.ts).
  it("without a network the driver may send: the fetch resumes by itself on reconnect", () => {
    expect(
      reviewFormState({ reason: "form-outdated", typeListed: true, refresh: "offline" }),
    ).toEqual({
      typeLocked: true,
      canSend: true,
      notice:
        "Sem conexão para buscar o formulário atual. Você pode enviar assim: o registro fica salvo no aparelho e, se o formulário tiver mudado, volta para revisão. A busca continua quando a conexão voltar.",
    });
    expect(reviewFormState({ reason: null, typeListed: true, refresh: "offline" }).canSend).toBe(
      true,
    );
  });

  it("a new report is never held to a type, and waits only while a refusal's form is fetched", () => {
    expect(reviewFormState({ reason: null, typeListed: true, refresh: "idle" })).toEqual({
      typeLocked: false,
      canSend: true,
      notice: null,
    });
    expect(reviewFormState({ reason: null, typeListed: true, refresh: "loading" })).toEqual({
      typeLocked: false,
      canSend: false,
      notice: "Buscando o formulário atual…",
    });
  });
});
