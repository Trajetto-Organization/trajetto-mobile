import {
  MODULE_LABEL,
  moduleOfSubmission,
} from "@/features/access/module-rules";

import {
  OTHER_COMPANY_REVIEW,
  reviewAccessOf,
} from "@/features/occurrences/occurrence-queue-rules";

import { resendVerdict, type SubmissionOwnership } from "./outbox-rules";

/**
 * What the pending screen says about one queued submission, and what it lets
 * the driver do about it.
 *
 * Pure, so the promise the screen makes can be tested: every item that will
 * not leave on its own says why and offers a way out. A parked item used to
 * read "Aguardando conexão." — false, since it was waiting for the company
 * to switch a module back on — and offered nothing at all (MOB-03).
 */

type PendingTone = "neutral" | "warning" | "danger";

interface PendingItemView {
  tone: PendingTone;
  message: string;
  canDiscard: boolean;

  /** The label of the "send again" button, or null when there is none. */
  retryLabel: string | null;

  /** A departure past its day: nothing but discarding can help. */
  isExpired: boolean;

  /**
   * The label of the button that reopens the item to be corrected (an
   * occurrence whose form changed), when its refusal has that fix. Absent
   * otherwise.
   */
  reviewLabel?: string;
}

interface PendingItemInput {
  kind: string;
  createdAt: string;
  status: "pending" | "failed" | "parked";
  attempts: number;
  lastError?: string;
  failure?: string;
  failureCode?: string;

  /** The company it was queued for. */
  businessId?: string;
}

/** What the screen knows about the session, for the rules that depend on it. */
interface PendingItemContext {
  /** The company selected now: a review reads only its catalog. */
  businessId?: string | null;
}

/**
 * The refusals that mean the delivery is no longer on this driver's route
 * (route design §6.4): the dispatcher took it off, or moved it to another
 * driver, after the step was queued. The API answers with its generic 404
 * ("Entrega não encontrada! Por favor, tente novamente."), which reads like
 * a bug; the driver needs the context instead.
 */
const LEFT_ROUTE_CODES: Readonly<Record<string, string>> = {
  "delivery-arrival": "DELIVERY_NOT_FOUND",
  "delivery-proof": "DELIVERY_NOT_FOUND",
  "delivery-delivered": "DELIVERY_NOT_FOUND",
  "delivery-occurrence": "DELIVERY_NOT_FOUND",
  "delivery-on-the-way": "ROUTE_STOP_NOT_FOUND",
};

const LEFT_ROUTE_MESSAGE =
  "Esta entrega foi retirada da sua rota. Fale com a central antes de descartar este envio.";

const leftTheRoute = (item: PendingItemInput): boolean =>
  Boolean(item.failureCode) && LEFT_ROUTE_CODES[item.kind] === item.failureCode;

/**
 * "Iniciar rota" on a route the driver no longer holds: the API answers the
 * same 404 DELIVERY_ROUTE_NOT_FOUND for a deleted route, another company's
 * and one reassigned to another driver. It used to say BAD_REQUEST, so the
 * card showed only "Rota não encontrada."
 */
const ROUTE_LEFT_CODE = "DELIVERY_ROUTE_NOT_FOUND";

const ROUTE_LEFT_MESSAGE =
  "Esta rota foi retirada de você. Fale com a central antes de descartar este envio.";

const routeWasTaken = (item: PendingItemInput): boolean =>
  item.kind === "delivery-start-route" && item.failureCode === ROUTE_LEFT_CODE;

function describePendingItem(
  item: PendingItemInput,
  ownership: SubmissionOwnership,
  now: number,
  context: PendingItemContext = {},
): PendingItemView {
  // An "Iniciar rota" past its day cannot be sent again: a retry fails it at
  // once (resendVerdict). Only discarding is offered, with the reason saying
  // to tap "Iniciar rota" again — the one action that still helps.
  const verdict = resendVerdict(item, now);

  if (!verdict.resendable) {
    return {
      tone: "danger",
      message: verdict.reason,
      canDiscard: true,
      retryLabel: null,
      isExpired: true,
    };
  }

  // Queued by a version of the app that did not record who was signed in.
  // Sending it on its own would file it under whoever holds the phone now.
  if (ownership === "unclaimed") {
    return {
      tone: "danger",
      message:
        "Este envio ficou salvo de um acesso anterior. Confirme que é seu para enviá-lo com o seu login.",
      canDiscard: true,
      retryLabel: "É meu, enviar",
      isExpired: false,
    };
  }

  // An occurrence refused over its form waits for the driver's answers, not
  // for an update or a resend that would meet the same refusal (contract §6).
  // Reviewed only under its own company: the review reads the selected
  // company's catalog, and another one's type would end in a 404.
  const access = reviewAccessOf(item, context.businessId);

  if (access.state === "here") {
    return {
      tone: "warning",
      message: access.review.message,
      canDiscard: true,
      retryLabel: null,
      isExpired: false,
      reviewLabel: access.review.actionLabel,
    };
  }

  if (access.state === "other-company") {
    return {
      tone: "warning",
      message: `${access.review.message} ${OTHER_COMPANY_REVIEW}`,
      canDiscard: true,
      retryLabel: null,
      isExpired: false,
    };
  }

  if (item.status === "failed" && (leftTheRoute(item) || routeWasTaken(item))) {
    return {
      tone: "danger",
      message: routeWasTaken(item) ? ROUTE_LEFT_MESSAGE : LEFT_ROUTE_MESSAGE,
      canDiscard: true,
      // Kept: if the dispatcher puts it back on this driver's route, the same
      // submission goes through.
      retryLabel: "Tentar de novo",
      isExpired: false,
    };
  }

  if (item.status === "failed") {
    return {
      tone: "danger",
      message: `${item.lastError || "O servidor recusou este envio."}${
        item.failure === "contract"
          ? " Atualize o aplicativo: este envio sai sozinho depois da atualização."
          : ""
      }`,
      canDiscard: true,
      retryLabel: "Tentar de novo",
      isExpired: false,
    };
  }

  if (item.status === "parked") {
    const module = moduleOfSubmission(item.kind);
    const which = module ? `o módulo ${MODULE_LABEL[module]}` : "um módulo";

    return {
      tone: "warning",
      message: `Aguardando a empresa reativar ${which}. O envio sai sozinho quando o módulo voltar.`,
      canDiscard: true,
      retryLabel: "Tentar agora",
      isExpired: false,
    };
  }

  return {
    tone: "neutral",
    message:
      item.attempts === 0
        ? "Aguardando conexão."
        : `Aguardando nova tentativa (${item.attempts} ${
            item.attempts === 1 ? "tentativa" : "tentativas"
          }).`,
    canDiscard: false,
    retryLabel: null,
    isExpired: false,
  };
}

export { LEFT_ROUTE_MESSAGE, ROUTE_LEFT_MESSAGE, describePendingItem };
export type { PendingItemContext, PendingItemView, PendingTone };
