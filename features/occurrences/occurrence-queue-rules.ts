/**
 * An occurrence the queue could not deliver because of its FORM, and what
 * the driver does about it (docs/contratos-app/occurrences.md §6 and §7).
 *
 * The queue fails such an item like any refusal — kept on the phone, visible,
 * never dropped — and records the API's code on it. These rules read that
 * code: instead of "Tentar de novo", which would meet the same answer, the
 * pending screen offers to reopen the report with the current form and the
 * answers already given. Pure and import-free, like `pending-item-rules`.
 */

const OCCURRENCE_KIND = "delivery-occurrence";

/**
 * Decision 14.3: a delivery proof is a DELIVERED occurrence, sent through the
 * same report route and refused for the same form reasons (design §8.3).
 * Failing it like any refusal threw away the receipt and the signature after
 * the customer had left: it is reviewed on the proof screen instead.
 */
const DELIVERED_KIND = "delivery-delivered";

type ReviewReason = "form-outdated" | "form-unanswered" | "form-invalid" | "type-unavailable";

/** The API's refusals a review can fix, by code. */
const REVIEW_REASON_BY_CODE: Record<string, ReviewReason> = {
  // The form changed since the phone cached it (409).
  OCCURRENCE_FORM_OUTDATED: "form-outdated",
  // A report queued by a build before forms, on a type that now asks (400).
  CLIENT_OUTDATED: "form-unanswered",
  // Answers the current form refuses (400): the driver can correct them.
  OCCURRENCE_FORM_INVALID: "form-invalid",
  // The type was switched off after the phone cached it: pick another.
  OCCURRENCE_TYPE_INACTIVE: "type-unavailable",
};

type ReviewCopy = Record<ReviewReason, { message: string; actionLabel: string }>;

const REVIEW_COPY: ReviewCopy = {
  "form-outdated": {
    message:
      "O formulário deste tipo de ocorrência mudou. Revise as respostas e envie de novo: o que você já preencheu foi mantido.",
    actionLabel: "Revisar formulário",
  },
  "form-unanswered": {
    message:
      "Este tipo de ocorrência agora tem perguntas. Responda o formulário para enviar o registro.",
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
};

/** The same reasons, said about a delivery: what was collected is kept. */
const DELIVERED_REVIEW_COPY: ReviewCopy = {
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
};

const COPY_BY_KIND: Record<string, ReviewCopy> = {
  [OCCURRENCE_KIND]: REVIEW_COPY,
  [DELIVERED_KIND]: DELIVERED_REVIEW_COPY,
};

/** The screen that reopens a queued item of each reviewable kind. */
const REVIEW_SCREEN_BY_KIND: Record<string, "/delivery-occurrence" | "/delivery-proof"> = {
  [OCCURRENCE_KIND]: "/delivery-occurrence",
  [DELIVERED_KIND]: "/delivery-proof",
};

/**
 * Said where a review is refused because the report is another company's.
 * The review screen reads the types of the company selected NOW; another
 * one's catalog would put its ids in this report and meet a 404 no review
 * fixes. Only a MASTER switches company in the app, and a driver meets this
 * after being moved between companies: discarding or asking is what is left.
 */
const OTHER_COMPANY_REVIEW =
  "Este envio é de outra empresa e não pode ser revisado neste acesso: descarte-o ou fale com o gestor.";

interface ReviewableItem {
  kind: string;
  status: string;
  failureCode?: string;

  /** The company the report was filed for (every queued item has one). */
  businessId?: string;
}

interface OccurrenceReview {
  reason: ReviewReason;
  message: string;
  actionLabel: string;
}

/**
 * Why this failed occurrence — or delivery proof (decision 14.3) — waits for
 * the driver's review, or null.
 */
function occurrenceReviewOf(item: ReviewableItem): OccurrenceReview | null {
  const copy = COPY_BY_KIND[item.kind];

  if (!copy || item.status !== "failed") return null;

  const reason = item.failureCode ? REVIEW_REASON_BY_CODE[item.failureCode] : undefined;

  return reason ? { reason, ...copy[reason] } : null;
}

/**
 * Where the pending screen sends the driver to review this item: the screen
 * of its kind, with the delivery from the item's own URL. Null when the item
 * has nothing to review or its URL names no delivery.
 */
function reviewRouteOf(
  item: ReviewableItem & { id: string; endpoint: string },
): {
  pathname: "/delivery-occurrence" | "/delivery-proof";
  params: { id: string; review: string };
} | null {
  if (!occurrenceReviewOf(item)) return null;

  const target = occurrenceTargetOf(item.endpoint);

  return target
    ? {
        pathname: REVIEW_SCREEN_BY_KIND[item.kind],
        params: { id: target.deliveryId, review: item.id },
      }
    : null;
}

type ReviewAccess =
  | { state: "none" }
  | { state: "here"; review: OccurrenceReview }
  | { state: "other-company"; review: OccurrenceReview };

/**
 * Whether the driver can review this item with the company selected now.
 * Only the report's own company: the outbox lists the driver's items of
 * every company, while the screen that reviews reads one catalog. Without a
 * company to compare, nothing is offered — a review that cannot be shown to
 * be the same company's is the one that ends in a 404.
 */
function reviewAccessOf(
  item: ReviewableItem,
  currentBusinessId: string | null | undefined,
): ReviewAccess {
  const review = occurrenceReviewOf(item);

  if (!review) return { state: "none" };

  return isSameCompany(item, currentBusinessId)
    ? { state: "here", review }
    : { state: "other-company", review };
}

const isSameCompany = (
  item: ReviewableItem,
  currentBusinessId: string | null | undefined,
): boolean =>
  typeof currentBusinessId === "string" &&
  currentBusinessId.length > 0 &&
  item.businessId === currentBusinessId;

/** What `review=<id>` opens on the report screen. */
type ReviewEntry = "open" | "other-company" | "no-review" | "gone";

/**
 * Judged on the item as the screen first found it (held afterwards, so the
 * revision itself does not flip the screen). Another company's item is
 * blocked whatever its state — a deep link or a back-navigation reaches it
 * too, and its types are not in the catalog on screen — and an item with
 * nothing to review says so instead of a form that could only fail.
 */
function reviewEntryOf(
  item: ReviewableItem | null,
  currentBusinessId: string | null | undefined,
): ReviewEntry {
  if (!item) return "gone";
  if (!isSameCompany(item, currentBusinessId)) return "other-company";

  return occurrenceReviewOf(item) ? "open" : "no-review";
}

/**
 * What the report screen does with a refusal it got at the tap. Read from the
 * code only: `ApiError` and the phone's own `OccurrenceFormError` both say it.
 */
function refusalReaction(error: unknown): ReviewReason | null {
  if (!error || typeof error !== "object") return null;

  if ((error as { name?: unknown }).name === "OccurrenceFormError") {
    return "form-invalid";
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === "string" ? (REVIEW_REASON_BY_CODE[code] ?? null) : null;
}

interface RefusalScreenChange {
  /** Every field shows what it needs, touched or not. */
  markFields: boolean;

  /** The "O formulário mudou" banner. */
  formChanged: boolean;

  /** The type was switched off: the driver picks another. */
  clearType: boolean;

  /** Read the day again for the current form (the API's refusal came from it). */
  refetch: boolean;
}

/**
 * The screen's change for a refusal at the tap, besides the toast. The
 * phone's own check refetches nothing: it judged the form on screen. Null
 * for any other failure, which the toast alone describes.
 */
function refusalScreenChange(error: unknown): RefusalScreenChange | null {
  const reaction = refusalReaction(error);
  if (!reaction) return null;

  const fromPhone = (error as { name?: unknown }).name === "OccurrenceFormError";

  return {
    markFields: true,
    formChanged: !fromPhone && reaction === "form-outdated",
    clearType: !fromPhone && reaction === "type-unavailable",
    refetch: !fromPhone,
  };
}

/**
 * The reread of the day that brings the current form, as the screen shows
 * it. "offline": asked without a network, when react-query pauses the fetch
 * (networkMode "online") and its promise only settles once the network is
 * back — shown as "loading", it held the send for the whole dead zone.
 */
type FormRefresh = "idle" | "loading" | "offline" | "done" | "failed";

/**
 * What the screen shows: the first load of the day counts as a refresh
 * underway, and a refresh underway without a network is "offline" — the
 * driver can send, and the paused fetch resumes by itself on reconnect.
 */
function formRefreshOf(input: {
  /** The latest request, as its refetch settled (never "offline"). */
  requested: FormRefresh;
  listLoading: boolean;
  online: boolean;
}): FormRefresh {
  const underway = input.listLoading ? "loading" : input.requested;

  return underway === "loading" && !input.online ? "offline" : underway;
}

interface ReviewFormState {
  /** The report's type cannot be changed. */
  typeLocked: boolean;

  /** The send button may be pressed (the rest of the screen's checks apply). */
  canSend: boolean;

  /** A line above the form about the form itself, or null. */
  notice: string | null;
}

const FETCHING_FORM = "Buscando o formulário atual…";
const FORM_FETCH_FAILED =
  "Não foi possível buscar o formulário atual. Você pode enviar assim: se ele tiver mudado de novo, o registro volta para revisão.";
const FORM_FETCH_OFFLINE =
  "Sem conexão para buscar o formulário atual. Você pode enviar assim: o registro fica salvo no aparelho e, se o formulário tiver mudado, volta para revisão. A busca continua quando a conexão voltar.";
const TYPE_GONE = "O tipo deste registro não está mais disponível. Escolha outro tipo.";

/**
 * The form while the current version is fetched after a refusal (queued
 * review or the tap). Sending waits for the fetch: the cached form is the
 * one just refused. A fetch that fails, or cannot start for lack of a
 * network, does not hold the report hostage — a stale form only comes back
 * for review, nothing is lost.
 *
 * A queued report keeps its type (what happened at the stop), except when
 * the type was switched off, or is no longer listed once the list is known
 * — never while it is still loading, when "not listed" means nothing yet.
 */
function reviewFormState(input: {
  /** The queued report's reason; null for a new report. */
  reason: ReviewReason | null;
  typeListed: boolean;
  refresh: FormRefresh;
}): ReviewFormState {
  const loading = input.refresh === "loading";

  const holdsType = input.reason !== null && input.reason !== "type-unavailable";
  const typeGone = holdsType && !input.typeListed && !loading;

  return {
    typeLocked: holdsType && !typeGone,
    canSend: !loading,
    notice: loading
      ? FETCHING_FORM
      : typeGone
        ? TYPE_GONE
        : input.refresh === "failed"
          ? FORM_FETCH_FAILED
          : input.refresh === "offline"
            ? FORM_FETCH_OFFLINE
            : null,
  };
}

const REPORT_ENDPOINT = /^\/delivery\/report-occurrence\/([^/]+)\/business\/([^/]+)$/;

/** The delivery (and company) a queued report is about, from its URL. */
function occurrenceTargetOf(
  endpoint: string,
): { deliveryId: string; businessId: string } | null {
  const match = REPORT_ENDPOINT.exec(endpoint);

  return match ? { deliveryId: match[1], businessId: match[2] } : null;
}

export {
  DELIVERED_REVIEW_COPY,
  OTHER_COMPANY_REVIEW,
  REVIEW_COPY,
  REVIEW_REASON_BY_CODE,
  formRefreshOf,
  occurrenceReviewOf,
  occurrenceTargetOf,
  refusalReaction,
  refusalScreenChange,
  reviewAccessOf,
  reviewEntryOf,
  reviewFormState,
  reviewRouteOf,
};

export type {
  FormRefresh,
  OccurrenceReview,
  RefusalScreenChange,
  ReviewAccess,
  ReviewEntry,
  ReviewFormState,
  ReviewReason,
  ReviewableItem,
};
