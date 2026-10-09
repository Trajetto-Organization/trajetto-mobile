import type {
  AuthorizationRequestStatus,
  DriverAuthorizationRequest,
} from "@/features/deliveries/types";

import { occurrenceReviewOf } from "./occurrence-queue-rules";

/**
 * The tower's authorization of an occurrence, as the driver sees it
 * (decision 6.3; docs/contratos-app/occurrences.md §3–§5).
 *
 * Pure: what the stop says while the request waits, what the driver is told
 * when the answer comes (socket or push) and how the cached day changes with
 * it. A product decision that needs a socket to be tested is one nobody
 * tests.
 */

const OCCURRENCE_KIND = "delivery-occurrence";

type Decision = "APPROVED" | "DENIED";

/** `deliveryEvent` in the driver's room, contract §5. */
interface OccurrenceDecisionEvent {
  type: "occurrence.authorization_decided";
  deliveryId: string;
  occurrenceId: string;
  decision: Decision;
  note: string | null;

  /** The delivery's status after the decision (FAILED after an approved blocking type). */
  deliveryStatus: string;
}

const isDecision = (value: unknown): value is Decision =>
  value === "APPROVED" || value === "DENIED";

/** Whether the payload is the tower's answer, before anything trusts its fields. */
function isOccurrenceDecisionEvent(value: unknown): value is OccurrenceDecisionEvent {
  if (!value || typeof value !== "object") return false;

  const event = value as Partial<OccurrenceDecisionEvent>;

  return (
    event.type === "occurrence.authorization_decided" &&
    typeof event.deliveryId === "string" &&
    typeof event.occurrenceId === "string" &&
    isDecision(event.decision) &&
    (event.note === null || event.note === undefined || typeof event.note === "string")
  );
}

/**
 * The decision push (topic `delivery-occurrence.authorization_decided`).
 *
 * The delivery is NOT read from `data.deliveryId`: the push pipeline stamps
 * its own record id under that key on every push, over the one the policy
 * wrote (the proof warning moved its delivery to `entityId` for the same
 * reason). The answer names its occurrence, and the cached day knows which
 * delivery asked it; `entityId` is taken when the API sends it.
 */
interface OccurrenceDecisionPush {
  occurrenceId: string;
  decision: Decision;

  /** The delivery, when the push names it in `entityId`. */
  entityId: string | null;

  /**
   * The delivery's status after the decision, when the push says it
   * (`data.deliveryStatus`; the API does not send it yet — see
   * `statusAfterDecision` for what stands in meanwhile).
   */
  deliveryStatus: string | null;

  /** The server's own words: the reason travels inside the body, not in `data`. */
  title: string | null;
  body: string | null;
}

interface PushContent {
  title?: string | null;
  body?: string | null;
  data?: unknown;
}

function occurrenceDecisionOfPush(content: PushContent | null | undefined): OccurrenceDecisionPush | null {
  const data = content?.data;

  if (!data || typeof data !== "object") return null;

  const { entityId, occurrenceId, decision, deliveryStatus } = data as Record<string, unknown>;

  if (typeof occurrenceId !== "string" || !isDecision(decision)) return null;

  return {
    occurrenceId,
    decision,
    entityId: typeof entityId === "string" ? entityId : null,
    deliveryStatus:
      typeof deliveryStatus === "string" && deliveryStatus.length > 0 ? deliveryStatus : null,
    title: typeof content?.title === "string" ? content.title : null,
    body: typeof content?.body === "string" ? content.body : null,
  };
}

/** What the day's cache knows about the delivery the answer is about. */
interface DecidedDelivery {
  id: string;
  recipient_name: string;
  status: string;
  authorization_request?: DriverAuthorizationRequest | null;
}

const ACTIVE_STATUSES = new Set(["PENDING", "IN_TRANSIT"]);

/** The delivery left the driver's work (Entregue, Insucesso, Cancelada). */
const isEnded = (deliveryStatus: string | null | undefined): deliveryStatus is string =>
  typeof deliveryStatus === "string" && !ACTIVE_STATUSES.has(deliveryStatus);

const STATUS_LABELS: Record<string, string> = {
  DELIVERED: "Entregue",
  FAILED: "Insucesso",
  CANCELLED: "Cancelada",
};

interface DecisionNotice {
  type: "success" | "error";
  title: string;
  message: string;
}

const sentence = (text: string): string => {
  const trimmed = text.trim();

  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/**
 * What the driver reads when the answer arrives, with what to do next. The
 * name is read from the CACHED row, before the refetch drops a delivery an
 * approval failed: "sua entrega" tells a driver with fourteen stops nothing.
 */
function decisionNotice(
  event: Pick<OccurrenceDecisionEvent, "decision" | "note"> & {
    deliveryStatus?: string | null;
  },
  delivery: DecidedDelivery | null,
): DecisionNotice {
  const who = delivery?.recipient_name ?? "Sua entrega";
  const note = event.note?.trim() ? event.note.trim() : null;

  if (event.decision === "DENIED") {
    return {
      type: "error",
      title: "Ocorrência não autorizada",
      message: `${who}: ${sentence(note ?? "a torre negou o pedido")} A entrega continua em rota: siga a orientação da torre ou fale com a base.`,
    };
  }

  if (isEnded(event.deliveryStatus)) {
    const label = STATUS_LABELS[event.deliveryStatus] ?? "encerrada";

    return {
      type: "success",
      title: "Ocorrência autorizada",
      message: `${who}: entrega registrada como ${label}. Siga para a próxima parada.${note ? ` ${sentence(note)}` : ""}`,
    };
  }

  return {
    type: "success",
    title: "Ocorrência autorizada",
    message: `${who}: pode seguir com a entrega.${note ? ` ${sentence(note)}` : ""}`,
  };
}

/**
 * The tower's note inside an approval push's body. The push has no note
 * field: the API writes "<tipo> — <destinatário>: pode seguir." followed by
 * the note, when there is one (contract §5). Null when the body says none,
 * or is worded some other way.
 */
function approvalNoteOfPushBody(body: string | null | undefined): string | null {
  const match = typeof body === "string" ? /:\s*pode seguir\.\s*([\s\S]+)$/.exec(body) : null;
  const note = match?.[1]?.trim();

  return note ? note : null;
}

/**
 * The toast for a decision push received with the app open: the push's own
 * words, which carry the tower's reason — except for an approval that ended
 * the delivery. The API's body says "pode seguir" for every approval, while
 * the stop says the delivery is Insucesso; then the app's own notice, with
 * the tower's note kept from the body.
 */
function decisionPushNotice(
  push: Pick<OccurrenceDecisionPush, "decision" | "title" | "body">,
  notice: DecisionNotice,
  deliveryStatus: string | null,
): DecisionNotice {
  const title = push.title ?? notice.title;

  if (push.decision !== "APPROVED" || !isEnded(deliveryStatus)) {
    return { type: notice.type, title, message: push.body ?? notice.message };
  }

  const note = approvalNoteOfPushBody(push.body);

  return {
    type: notice.type,
    title,
    message: note ? `${notice.message} ${sentence(note)}` : notice.message,
  };
}

/**
 * The delivery's status after the answer. The socket says it; the push
 * does not yet, and without it every tapped approval opened the delivery —
 * even one that failed it. Meanwhile: an approval of a type the cached day
 * knows as blocking failed the delivery (contract §3/§4), and a denial
 * leaves it in route. Null when unknown (treated as still open).
 */
function statusAfterDecision(
  answer: { occurrenceId: string; decision: Decision; deliveryStatus: string | null },
  delivery: DecidedDelivery | null,
  occurrenceTypes: readonly { id: string; blocks_delivery?: boolean }[],
): string | null {
  if (answer.deliveryStatus) return answer.deliveryStatus;

  const request = delivery?.authorization_request;

  // Only the request this answer is about names the type that was decided.
  if (answer.decision !== "APPROVED" || request?.occurrenceId !== answer.occurrenceId) {
    return null;
  }

  const blocks = occurrenceTypes.some(
    (type) => type.id === request.occurrenceTypeId && type.blocks_delivery === true,
  );

  return blocks ? "FAILED" : null;
}

/**
 * The cached day with the answer on its request, so the stop changes in the
 * second the answer arrives — and stays changed offline if the refetch that
 * follows never lands. Only the request it answers: a cache that does not
 * know it yet waits for that refetch rather than inventing its type.
 *
 * `note` undefined keeps what the cache had (a push carries no note field).
 */
function withDecision<T extends { id: string; authorization_request?: DriverAuthorizationRequest | null }>(
  deliveries: T[],
  decision: {
    occurrenceId: string;
    decision: Decision;
    note?: string | null;
    decidedAt: string;
  },
): T[] {
  return deliveries.map((delivery) => {
    const request = delivery.authorization_request;

    // By the occurrence, which names one request: the push cannot say which
    // delivery it is about (see `OccurrenceDecisionPush`).
    if (
      !request ||
      request.occurrenceId !== decision.occurrenceId ||
      // A request superseded (the proof won) is not brought back by a late answer.
      request.status === "SUPERSEDED"
    ) {
      return delivery;
    }

    return {
      ...delivery,
      authorization_request: {
        ...request,
        status: decision.decision,
        note: decision.note === undefined ? request.note : decision.note,
        decidedAt: decision.decidedAt,
      },
    };
  });
}

/**
 * The delivery an answer is about, from the cached day: the one whose request
 * it answers, else the one it names. Null when this phone does not know it.
 */
function decidedDeliveryOf<T extends { id: string; authorization_request?: DriverAuthorizationRequest | null }>(
  deliveries: readonly T[],
  answer: { occurrenceId: string; deliveryId?: string | null },
): T | null {
  return (
    deliveries.find(
      (delivery) => delivery.authorization_request?.occurrenceId === answer.occurrenceId,
    ) ??
    (answer.deliveryId
      ? deliveries.find((delivery) => delivery.id === answer.deliveryId)
      : undefined) ??
    null
  );
}

/**
 * The cached day with a request just filed (the report answered PENDING),
 * so "Aguardando autorização da torre" shows before the refetch lands.
 */
function withAuthorizationRequested<T extends { id: string; authorization_request?: DriverAuthorizationRequest | null }>(
  deliveries: T[],
  deliveryId: string,
  request: DriverAuthorizationRequest,
): T[] {
  return deliveries.map((delivery) =>
    delivery.id === deliveryId
      ? { ...delivery, authorization_request: request }
      : delivery,
  );
}

interface CachedDay<T> {
  data: T[];
  occurrence_types?: readonly { id: string; name: string }[];
}

/**
 * The cached day after a report the API answered PENDING — at the tap or
 * later from the queue: the stop says "Aguardando autorização da torre"
 * before the refetch lands, and keeps saying it if the refetch never does.
 * Anything else leaves the day as it was (the refetch tells the rest).
 *
 * `requestedAt` is when the API took the report — the 201's instant, which
 * is what the server's `requestedAt` (the row's created_at) means — not the
 * tap's `occurred_at`: a report tapped in a dead zone and sent half an hour
 * later was dated by the tap, lost to an older report queued in between,
 * and the stop changed again once the refetch brought the server's date.
 */
function withSentReport<
  T extends { id: string; authorization_request?: DriverAuthorizationRequest | null },
  D extends CachedDay<T>,
>(
  day: D | undefined,
  sent: {
    deliveryId: string;
    occurrenceTypeId: string;
    occurrenceTypeName?: string | null;
    requestedAt: string;
    report: SentReport;
  },
): D | undefined {
  const { report } = sent;

  if (!day || report.status !== "PENDING" || !report.occurrenceId) return day;

  const name =
    sent.occurrenceTypeName ??
    day.occurrence_types?.find((type) => type.id === sent.occurrenceTypeId)?.name ??
    "Ocorrência";

  return {
    ...day,
    data: withAuthorizationRequested(day.data, sent.deliveryId, {
      occurrenceId: report.occurrenceId,
      occurrenceTypeId: sent.occurrenceTypeId,
      occurrenceTypeName: name,
      status: "PENDING",
      note: null,
      decidedAt: null,
      requestedAt: sent.requestedAt,
    }),
  };
}

type SentAuthorizationStatus = "NOT_REQUIRED" | AuthorizationRequestStatus;

interface SentReport {
  occurrenceId: string | null;
  status: SentAuthorizationStatus;

  /**
   * Decision 14.5: the support ticket the report opened (or already had),
   * from the 201's `ticket`. Absent when the answer has none.
   */
  ticket?: { id: string; number: number };
}

/** `data` of the report's 201 (contract §3), read defensively. */
function sentReportOf(response: unknown): SentReport {
  const data =
    response && typeof response === "object"
      ? (response as { data?: unknown }).data
      : undefined;

  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const status = record.authorization_status;
  const ticket = record.ticket as { id?: unknown; number?: unknown } | null | undefined;

  return {
    occurrenceId: typeof record.id === "string" ? record.id : null,
    status:
      status === "PENDING" ||
      status === "APPROVED" ||
      status === "DENIED" ||
      status === "SUPERSEDED"
        ? status
        : "NOT_REQUIRED",
    ...(ticket &&
      typeof ticket.id === "string" &&
      typeof ticket.number === "number" && {
        ticket: { id: ticket.id, number: ticket.number },
      }),
  };
}

/** The toast after a report the API accepted at the tap. */
function sentReportNotice(status: SentAuthorizationStatus): { title: string; message: string } {
  if (status === "PENDING") {
    return {
      title: "Ocorrência registrada",
      message: "Aguardando autorização da torre. A resposta chega aqui e por notificação.",
    };
  }

  if (status === "SUPERSEDED") {
    return {
      title: "Ocorrência registrada",
      message: "A entrega já estava resolvida, então não há o que autorizar.",
    };
  }

  return { title: "Ocorrência registrada com sucesso!", message: "O gestor foi avisado." };
}

/** An outbox item, as far as the stop's state needs to read it. */
interface QueuedOccurrence {
  kind: string;
  status: string;
  endpoint: string;
  body: Record<string, unknown>;
  createdAt: string;
  failureCode?: string;
}

/** The newest occurrence of this delivery still on the phone, if any. */
function queuedOccurrenceFor(
  items: readonly QueuedOccurrence[],
  deliveryId: string,
): QueuedOccurrence | null {
  const prefix = `/delivery/report-occurrence/${deliveryId}/`;

  return items
    .filter((item) => item.kind === OCCURRENCE_KIND && item.endpoint.startsWith(prefix))
    .reduce<QueuedOccurrence | null>(
      (newest, item) =>
        !newest || Date.parse(item.createdAt) >= Date.parse(newest.createdAt)
          ? item
          : newest,
      null,
    );
}

type AuthorizationTone = "waiting" | "approved" | "denied" | "queued" | "attention";

interface AuthorizationView {
  tone: AuthorizationTone;

  /** One line: the list card shows only this. */
  title: string;

  /** What it is about, and the tower's words. */
  message: string | null;

  /** What the driver does now. */
  nextStep: string | null;

  /**
   * What the stop no longer leads with: an older report still on the phone
   * under a newer request, or the request under a newer report. Absent when
   * there is none.
   */
  secondary?: string;
}

interface ViewableType {
  id: string;
  requires_authorization?: boolean;
  blocks_delivery?: boolean;
}

const formatClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** The stop's line for an occurrence still on the phone. */
function queuedView(
  queued: QueuedOccurrence,
  occurrenceTypes: readonly ViewableType[],
): AuthorizationView {
  if (queued.status === "failed") {
    const review = occurrenceReviewOf(queued);

    return {
      tone: "attention",
      title: "Ocorrência não enviada",
      message: review?.message ?? "A empresa recusou o envio desta ocorrência.",
      nextStep: review
        ? `Abra Envios pendentes e toque em ${review.actionLabel}.`
        : "Abra Envios pendentes para ver o motivo e decidir.",
    };
  }

  const asksTower = occurrenceTypes.some(
    (type) =>
      type.id === queued.body.occurrenceTypeId && type.requires_authorization === true,
  );

  return {
    tone: "queued",
    title: asksTower
      ? "Pedido de autorização salvo no aparelho"
      : "Ocorrência salva no aparelho",
    message: null,
    // Parked: refused because the company switched the module off. It waits
    // for the module, not for a signal (pending-item-rules says the same).
    nextStep:
      queued.status === "parked"
        ? "Aguardando a empresa reativar o módulo Entregas."
        : asksTower
          ? "Vai para a torre quando houver conexão."
          : "Será enviada quando houver conexão.",
  };
}

/** The request of the day's payload, as the stop shows it. Null when silent. */
function requestView(
  request: DriverAuthorizationRequest,
  occurrenceTypes: readonly ViewableType[],
  formatTime: (iso: string) => string,
): AuthorizationView | null {
  const when =
    request.requestedAt && !Number.isNaN(Date.parse(request.requestedAt))
      ? ` · pedido às ${formatTime(request.requestedAt)}`
      : "";

  switch (request.status) {
    case "PENDING":
      return {
        tone: "waiting",
        title: "Aguardando autorização da torre",
        message: `${request.occurrenceTypeName}${when}`,
        nextStep:
          "A resposta chega aqui e por notificação. Se conseguir entregar enquanto espera, toque em Entregar: a comprovação vale.",
      };

    case "APPROVED": {
      // An approved blocking type failed the delivery (contract §4): the
      // card may linger until the next sync, and must not say "seguir".
      const blocks = occurrenceTypes.some(
        (type) => type.id === request.occurrenceTypeId && type.blocks_delivery === true,
      );

      return {
        tone: "approved",
        title: "Ocorrência autorizada",
        message: request.note
          ? `${request.occurrenceTypeName}: ${request.note}`
          : request.occurrenceTypeName,
        nextStep: blocks
          ? "Entrega registrada como Insucesso. Siga para a próxima parada."
          : "Pode seguir com a entrega.",
      };
    }

    case "DENIED":
      return {
        tone: "denied",
        title: "Ocorrência não autorizada",
        message: request.note
          ? `${request.occurrenceTypeName}: ${request.note}`
          : request.occurrenceTypeName,
        nextStep:
          "A entrega continua em rota. Siga a orientação da torre ou fale com a base.",
      };

    default:
      return null;
  }
}

/**
 * A request under a newer report on the phone, in one line: the tower may
 * still answer it (PENDING), and a denial's reason is what the driver was
 * told to follow.
 */
function requestLine(
  request: DriverAuthorizationRequest,
  occurrenceTypes: readonly ViewableType[],
): string | undefined {
  const name = request.occurrenceTypeName;
  const note = request.note?.trim() ? `: ${sentence(request.note.trim())}` : ".";

  switch (request.status) {
    case "PENDING":
      return `Pedido anterior (${name}) aguardando autorização da torre.`;

    case "APPROVED": {
      const blocks = occurrenceTypes.some(
        (type) => type.id === request.occurrenceTypeId && type.blocks_delivery === true,
      );

      return blocks
        ? `Pedido anterior (${name}) autorizado: entrega registrada como Insucesso.`
        : `Pedido anterior (${name}) autorizado${note}`;
    }

    case "DENIED":
      return `Pedido anterior (${name}) não autorizado${note}`;

    default:
      return undefined;
  }
}

/**
 * What the stop says about the tower (and about an occurrence still on the
 * phone). Null when there is nothing to say: no request, or one the attempt
 * outgrew (SUPERSEDED — the proof, the panel or the route ended it).
 *
 * The newer of the two wins: a report on the phone queued at or after the
 * request (the server has not heard it yet), or the request filed after an
 * older report that is still failed or waiting. The other one gets a second
 * line either way, so neither is forgotten: a live request under a newer
 * report may still be answered. The phone's clock stamps the report and the
 * server's the request; a skew only matters for two reports minutes apart.
 */
function authorizationView(input: {
  delivery: { id: string; authorization_request?: DriverAuthorizationRequest | null };
  queue?: readonly QueuedOccurrence[];
  occurrenceTypes?: readonly ViewableType[];
  formatTime?: (iso: string) => string;
}): AuthorizationView | null {
  const formatTime = input.formatTime ?? formatClock;
  const occurrenceTypes = input.occurrenceTypes ?? [];

  const queued = queuedOccurrenceFor(input.queue ?? [], input.delivery.id);
  const request = input.delivery.authorization_request ?? null;
  const shown = request ? requestView(request, occurrenceTypes, formatTime) : null;

  if (!queued) return shown;

  const requestedAt = request ? Date.parse(request.requestedAt) : Number.NaN;
  const queueIsNewer =
    !shown ||
    Number.isNaN(requestedAt) ||
    Date.parse(queued.createdAt) >= requestedAt;

  if (queueIsNewer) {
    const view = queuedView(queued, occurrenceTypes);
    const line = request && shown ? requestLine(request, occurrenceTypes) : undefined;

    return line ? { ...view, secondary: line } : view;
  }

  return {
    ...shown,
    secondary:
      queued.status === "failed"
        ? "Uma ocorrência anterior não foi enviada: veja em Envios pendentes."
        : "Uma ocorrência anterior ainda está salva no aparelho.",
  };
}

export {
  OCCURRENCE_KIND,
  authorizationView,
  approvalNoteOfPushBody,
  decidedDeliveryOf,
  decisionNotice,
  decisionPushNotice,
  isOccurrenceDecisionEvent,
  occurrenceDecisionOfPush,
  queuedOccurrenceFor,
  sentReportNotice,
  sentReportOf,
  statusAfterDecision,
  withAuthorizationRequested,
  withDecision,
  withSentReport,
};

export type {
  AuthorizationTone,
  AuthorizationView,
  ViewableType,
  DecidedDelivery,
  Decision,
  DecisionNotice,
  OccurrenceDecisionEvent,
  OccurrenceDecisionPush,
  QueuedOccurrence,
  SentAuthorizationStatus,
  SentReport,
};
