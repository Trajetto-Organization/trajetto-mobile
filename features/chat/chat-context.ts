import type { ChatRouteTag, ClientChatMessage } from "./types";

/**
 * What the driver's messages are about while the chip is up (decision 6.7).
 *
 * The conversation stays one per driver; each message may name the delivery
 * and the route it is about, so the panel can show a delivery's or a route's
 * messages. Pure and import-free so the rules are read by a test, not by a
 * device.
 */
interface ChatContext {
  delivery: { id: string; recipient: string } | null;
  route: ChatRouteTag | null;

  /**
   * Decision 14.5: the support ticket the messages go into, when the chat
   * was opened on one (a push, "Falar com a central sobre isto"). Absent
   * otherwise: the API files a message about a delivery or route in that
   * delivery's or route's ticket by itself.
   */
  ticket?: ChatTicketRef | null;
}

/** "#128 · Cliente ausente — Mercado Sol": what the composer says. */
interface ChatTicketRef {
  id: string;
  number: number | null;
  subject: string | null;
}

/** expo-router hands a param as a string, or as an array when repeated. */
type RouteParam = string | string[] | undefined;

/** What a screen opens the chat tab with (see `chatContextParams`). */
interface ChatContextParams {
  deliveryId?: RouteParam;
  recipient?: RouteParam;
  routeId?: RouteParam;
  routeCode?: RouteParam;
  routeName?: RouteParam;

  /** Decision 14.5: the ticket to write in (number and subject for the chip). */
  ticketId?: RouteParam;
  ticketNumber?: RouteParam;
  ticketSubject?: RouteParam;

  /** A new value per tap: opening the chat again re-applies the chip. */
  contextAt?: RouteParam;
}

/** The fields a message carries its context in. */
type ChatContextFields = Pick<
  ClientChatMessage,
  "deliveryId" | "delivery" | "routeId" | "route" | "ticketId"
>;

/**
 * The API's answers for a delivery or route the message may no longer cite:
 * gone, moved to another driver, or of another company. The message itself
 * is fine; only its reference is stale.
 */
const STALE_CONTEXT_CODES: ReadonlySet<string> = new Set([
  "CHAT_DELIVERY_NOT_FOUND",
  "CHAT_ROUTE_NOT_FOUND",
  "CHAT_ROUTE_OTHER_DRIVER",

  // Decision 14.5: the ticket was closed (or is no longer this driver's).
  // The words go again without it: the API files them as a new subject.
  "SUPPORT_TICKET_CLOSED",
  "SUPPORT_TICKET_NOT_FOUND",
]);

/** Refusals that are about the ticket, not about a delivery or route. */
const TICKET_CONTEXT_CODES: ReadonlySet<string> = new Set([
  "SUPPORT_TICKET_CLOSED",
  "SUPPORT_TICKET_NOT_FOUND",
]);

const ROUTE_CODE = /^\d+$/;

function firstParam(value: RouteParam): string {
  const raw = Array.isArray(value) ? value[0] : value;

  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * The chip a screen asked for, or `null` when it asked for none.
 *
 * A delivery needs its recipient (the chip shows it) and a route needs its
 * number: a half-filled param is dropped rather than shown as "Rota NaN".
 */
function chatContextFromParams(params: ChatContextParams): ChatContext | null {
  const deliveryId = firstParam(params.deliveryId);
  const recipient = firstParam(params.recipient);

  const routeId = firstParam(params.routeId);
  const routeCode = firstParam(params.routeCode);

  const delivery = deliveryId && recipient ? { id: deliveryId, recipient } : null;

  const route =
    routeId && ROUTE_CODE.test(routeCode)
      ? {
          id: routeId,
          code: Number(routeCode),
          name: firstParam(params.routeName) || null,
        }
      : null;

  const ticketId = firstParam(params.ticketId);
  const ticketNumber = firstParam(params.ticketNumber);

  const ticket: ChatTicketRef | null = ticketId
    ? {
        id: ticketId,
        number: ROUTE_CODE.test(ticketNumber) ? Number(ticketNumber) : null,
        subject: firstParam(params.ticketSubject) || null,
      }
    : null;

  if (!delivery && !route && !ticket) return null;

  // `ticket` only when there is one: a chip about a delivery reads exactly
  // as it did before the tickets.
  return ticket ? { delivery, route, ticket } : { delivery, route };
}

/**
 * The params that open the chat on `context`.
 *
 * Every key goes out, empty when unused: the tab is already mounted, and a
 * key left over from the previous visit (a route name, a delivery) must not
 * leak into this chip.
 */
function chatContextParams(
  context: ChatContext,
  at: number = Date.now(),
): Record<keyof ChatContextParams, string> {
  return {
    deliveryId: context.delivery?.id ?? "",
    recipient: context.delivery?.recipient ?? "",
    routeId: context.route?.id ?? "",
    routeCode: context.route ? String(context.route.code) : "",
    routeName: context.route?.name ?? "",
    ticketId: context.ticket?.id ?? "",
    ticketNumber: context.ticket?.number != null ? String(context.ticket.number) : "",
    ticketSubject: context.ticket?.subject ?? "",
    contextAt: String(at),
  };
}

/** The route fields a chip needs, whatever screen the route comes from. */
type RouteLike = Pick<ChatRouteTag, "id" | "code" | "name">;

/**
 * "Falar com a base" from a delivery: the delivery, and the route its open
 * stop is on, when it is on one (a delivery holds at most one open stop).
 */
function chatContextOfDelivery(delivery: {
  id: string;
  recipient_name: string;
  stops?: ReadonlyArray<{ route: RouteLike }> | null;
}): ChatContext {
  const route = delivery.stops?.[0]?.route ?? null;

  return {
    delivery: { id: delivery.id, recipient: delivery.recipient_name },
    route: route ? { id: route.id, code: route.code, name: route.name } : null,
  };
}

/** "Falar com a base" from a route's section of the list. */
function chatContextOfRoute(route: RouteLike): ChatContext {
  return {
    delivery: null,
    route: { id: route.id, code: route.code, name: route.name },
  };
}

/** Changes exactly when the screen was opened again with a chip. */
function chatContextParamsKey(params: ChatContextParams): string {
  return [
    firstParam(params.contextAt),
    firstParam(params.deliveryId),
    firstParam(params.routeId),
    firstParam(params.ticketId),
  ].join("|");
}

/** "Rota 42 · Zona Sul", or "Rota 42" for a route with no name. */
function chatRouteLabel(route: Pick<ChatRouteTag, "code" | "name">): string {
  return route.name ? `Rota ${route.code} · ${route.name}` : `Rota ${route.code}`;
}

/** What the composer's chip reads. */
function chatContextLabel(context: ChatContext): string {
  if (context.ticket) {
    const number = context.ticket.number != null ? `#${context.ticket.number}` : "Atendimento";

    return context.ticket.subject
      ? `Assunto: ${number} · ${context.ticket.subject}`
      : `Assunto: ${number}`;
  }

  if (context.delivery) {
    const route = context.route ? ` · Rota ${context.route.code}` : "";

    return `Sobre a entrega: ${context.delivery.recipient}${route}`;
  }

  return context.route ? `Sobre a ${chatRouteLabel(context.route)}` : "";
}

/**
 * The context as a message carries it, before the server confirms it.
 *
 * The bubble shows the chip at once instead of popping it in when the send
 * lands. The delivery's status is the server's to say: the confirmed message
 * replaces this one whole.
 */
function chatContextFields(context: ChatContext | null | undefined): ChatContextFields {
  return {
    deliveryId: context?.delivery?.id ?? null,
    delivery: context?.delivery
      ? {
          id: context.delivery.id,
          recipient_name: context.delivery.recipient,
          status: "",
        }
      : null,
    routeId: context?.route?.id ?? null,
    route: context?.route ?? null,
    ticketId: context?.ticket?.id ?? null,
  };
}

/**
 * What `/chat/send-message` is told about the context.
 *
 * A delivery goes alone: the API tags the route that carries it, which is
 * fresher than the route a seven-day cache remembers for it. A route goes
 * only when it is the whole context (a message about a route, from its
 * section of the list).
 */
function chatContextBody(
  message: Pick<ClientChatMessage, "deliveryId" | "routeId" | "ticketId">,
): ChatContextReference {
  // A ticket names its own delivery and route on the server.
  if (message.ticketId) return { ticketId: message.ticketId };
  if (message.deliveryId) return { deliveryId: message.deliveryId };
  if (message.routeId) return { routeId: message.routeId };

  return {};
}

/** The reference a message sends (`chatContextBody`), or refused. */
interface ChatContextReference {
  deliveryId?: string;
  routeId?: string;
  ticketId?: string;
}

/** A photo staged in the composer, as the picker hands it over. */
interface StagedChatImage {
  uri: string;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string | null;
}

/**
 * One message per staged photo, in the order the driver picked them.
 *
 * The caption closes the batch (on the last photo): repeated on every photo
 * it would turn one remark into ten. The context rides on EVERY photo, so a
 * delivery's history shows the whole batch — the grid still draws one chip.
 */
function composeImageBatch(
  images: readonly StagedChatImage[],
  caption: string,
  context: ChatContext | null,
): Array<StagedChatImage & {
  kind: "IMAGE";
  body: string | undefined;
  context: ChatContext | null;
}> {
  const lastIndex = images.length - 1;

  return images.map((image, index) => ({
    kind: "IMAGE" as const,
    body: index === lastIndex ? caption || undefined : undefined,
    uri: image.uri,
    fileName: image.fileName,
    fileSize: image.fileSize,
    mimeType: image.mimeType,
    context,
  }));
}

/** One line of a delivery's conversation preview. */
interface LinkedMessagePreview {
  id: string;
  who: string;
  text: string;
  at: string;
}

/**
 * The latest messages about a delivery or a route, oldest first (the API
 * answers newest first), as the app previews them (decision 6.7: the
 * delivery/route shows its messages).
 */
function linkedMessagesPreview(
  page: ReadonlyArray<
    Pick<ClientChatMessage, "id" | "kind" | "body" | "senderId" | "sender" | "created_at">
  >,
  myUserId: string,
): LinkedMessagePreview[] {
  return [...page].reverse().map((message) => ({
    id: message.id,
    who:
      message.senderId === myUserId
        ? "Você"
        : message.sender?.name?.trim() || "Central",
    text:
      message.body?.trim() ||
      (message.kind === "AUDIO"
        ? "Mensagem de voz"
        : message.kind === "IMAGE"
          ? "Foto"
          : ""),
    at: message.created_at,
  }));
}

/**
 * When a linked message was said, on the phone's clock: "14:02" for today,
 * "28/09 às 14:02" before. A delivery's messages can span days (reopened the
 * next day), and a bare time read as today's.
 */
function linkedMessageMoment(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "";

  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const today =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (today) return time;

  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  return `${day} às ${time}`;
}

function hasChatContext(
  message: Pick<ClientChatMessage, "deliveryId" | "routeId" | "ticketId">,
): boolean {
  return Boolean(message.deliveryId || message.routeId || message.ticketId);
}

/** What the driver is told when a reference is dropped from a message. */
function staleContextNotice(error: unknown): { title: string; text: string } {
  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;

  if (typeof code === "string" && TICKET_CONTEXT_CODES.has(code)) {
    return {
      title: "Atendimento encerrado",
      text: "A central encerrou esse assunto. A mensagem segue como um novo assunto.",
    };
  }

  return {
    title: "Referência removida",
    text: "A entrega ou rota citada não está mais com você. A mensagem segue sem ela.",
  };
}

/**
 * Whether the API refused the message only for what it cites.
 *
 * Checked on the code, never on the status alone: a 404 of another kind (the
 * driver's own record gone) is not fixed by dropping the chip.
 */
function isStaleContextRejection(
  error: unknown,
  message: Pick<ClientChatMessage, "deliveryId" | "routeId" | "ticketId">,
): boolean {
  if (!hasChatContext(message)) return false;

  const code =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;

  return typeof code === "string" && STALE_CONTEXT_CODES.has(code);
}

/**
 * The message, on screen, without its reference: what is about to go again
 * after the API refused what it cited. Its send state is left as it is.
 */
function stripChatContext(
  list: ClientChatMessage[],
  clientSubmissionId: string,
): ClientChatMessage[] {
  return list.map((message) =>
    message.client_submission_id === clientSubmissionId
      ? { ...message, ...chatContextFields(null) }
      : message,
  );
}

/** Notes the ids a refused message cited — the ones the API was sent. */
function rememberRefusedContext(
  refused: Set<string>,
  message: Pick<ClientChatMessage, "deliveryId" | "routeId" | "ticketId">,
): void {
  Object.values(chatContextBody(message)).forEach((id) => {
    if (id) refused.add(id);
  });
}

/** Whether the message would cite a reference the API already refused. */
function citesRefusedContext(
  message: Pick<ClientChatMessage, "deliveryId" | "routeId" | "ticketId">,
  refused: ReadonlySet<string>,
): boolean {
  return Object.values(chatContextBody(message)).some(
    (id) => id !== undefined && refused.has(id),
  );
}

/**
 * Whether the chip up now would send what the API refused.
 *
 * The refusal lands after the send, and the driver may have opened the chat
 * on another delivery in between: that newer chip is valid and stays.
 */
function chipCitesRefused(
  context: ChatContext | null,
  refused: ChatContextReference,
): boolean {
  if (!context) return false;

  const ids = new Set(
    Object.values(refused).filter((id): id is string => Boolean(id)),
  );

  return citesRefusedContext(chatContextFields(context), ids);
}

export {
  STALE_CONTEXT_CODES,
  chatContextBody,
  chatContextFields,
  chatContextFromParams,
  chatContextLabel,
  chatContextOfDelivery,
  chatContextOfRoute,
  chatContextParams,
  chatContextParamsKey,
  chatRouteLabel,
  chipCitesRefused,
  citesRefusedContext,
  composeImageBatch,
  hasChatContext,
  isStaleContextRejection,
  linkedMessageMoment,
  linkedMessagesPreview,
  rememberRefusedContext,
  staleContextNotice,
  stripChatContext,
};
export type {
  ChatTicketRef,
  ChatContext,
  ChatContextParams,
  ChatContextReference,
  LinkedMessagePreview,
};
