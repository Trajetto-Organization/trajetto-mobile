import type { ClientChatMessage, DriverTicket } from "./types";

/**
 * The driver's side of the support tickets (decision 14.5, design §8): the
 * conversation stays one, split into subjects by separators; the driver
 * never manages tickets. Pure and import-free so a test reads the rules.
 */

/** Only the fields the separators read; the API's view carries more. */
type TicketLike = Pick<DriverTicket, "id" | "number" | "status" | "subject" | "version"> &
  Partial<Pick<DriverTicket, "close_outcome" | "close_note">>;

const OUTCOME_LABELS: Record<string, string> = {
  RESOLVED: "Resolvido",
  APPROVED: "Autorizado: pode seguir",
  DENIED: "Negado",
  MIGRATED: "Conversa anterior",
};

/**
 * Whether a subject separator goes above `current`: the ticket changed from
 * the message above. A message without a ticket (a mass notice, or one from
 * the 7-day cache written before the tickets) never opens a subject.
 */
function needsTicketSeparator(
  previous: Pick<ClientChatMessage, "ticketId"> | undefined,
  current: Pick<ClientChatMessage, "ticketId">,
): boolean {
  if (!current.ticketId) return false;

  return (previous?.ticketId ?? null) !== current.ticketId;
}

/** "#128 · Cliente ausente — Mercado Sol", and how it ended once closed. */
function ticketSeparatorLabel(ticket: TicketLike | undefined): string {
  if (!ticket) return "Assunto";

  const title = `#${ticket.number} · ${ticket.subject}`;

  if (ticket.status !== "CLOSED") return title;

  const outcome = ticket.close_outcome ? OUTCOME_LABELS[ticket.close_outcome] : null;

  return outcome ? `${title} — Atendimento encerrado · ${outcome}` : `${title} — Atendimento encerrado`;
}

/**
 * Tickets learned from a page or an event, newest version wins: replicas
 * promise no order, and an older copy arriving late must not reopen what
 * the driver already saw closed.
 */
function mergeTickets(
  current: ReadonlyMap<string, TicketLike>,
  incoming: ReadonlyArray<TicketLike> | undefined | null,
): Map<string, TicketLike> {
  const next = new Map(current);

  for (const ticket of incoming ?? []) {
    if (!ticket?.id) continue;

    const known = next.get(ticket.id);

    if (!known || ticket.version >= known.version) next.set(ticket.id, ticket);
  }

  return next;
}

/** The `supportTicket` events the driver hears (design §7.1). */
interface DriverTicketEvent {
  type: "ticket.opened" | "ticket.closed" | "ticket.reopened" | string;
  ticket: TicketLike;
}

function applyTicketEvent(
  current: ReadonlyMap<string, TicketLike>,
  event: DriverTicketEvent | null | undefined,
): Map<string, TicketLike> {
  if (!event?.ticket?.id) return new Map(current);

  return mergeTickets(current, [event.ticket]);
}

/**
 * Whether the chip's ticket has just closed (the chip then goes back to the
 * default, and the driver is told why).
 */
function chipTicketClosed(
  chipTicketId: string | null | undefined,
  tickets: ReadonlyMap<string, TicketLike>,
): boolean {
  if (!chipTicketId) return false;

  return tickets.get(chipTicketId)?.status === "CLOSED";
}

/**
 * The chat params a chat push opens with (design §8.5): the push names the
 * ticket; its number and subject, when sent, label the chip at once.
 */
function ticketParamsOfPush(data: unknown): {
  ticketId: string;
  ticketNumber: string;
  ticketSubject: string;
  contextAt: string;
} | null {
  if (!data || typeof data !== "object") return null;

  const record = data as Record<string, unknown>;
  const ticketId = typeof record.ticketId === "string" ? record.ticketId.trim() : "";

  if (!ticketId) return null;

  const number = record.ticketNumber;

  return {
    ticketId,
    ticketNumber:
      typeof number === "number" && Number.isInteger(number)
        ? String(number)
        : typeof number === "string" && /^\d+$/.test(number)
          ? number
          : "",
    ticketSubject: typeof record.ticketSubject === "string" ? record.ticketSubject : "",
    contextAt: String(Date.now()),
  };
}

/** The tower's read cursor per ticket (decision 14.5): ticketId → ISO instant. */
type TicketReadCursors = Readonly<Record<string, string>>;

function laterIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;

  return new Date(a) > new Date(b) ? a : b;
}

/**
 * Cursors from a page (`counterpartTicketReadAt`), advance-only: a page can
 * answer with a snapshot older than a `chatRead` already applied. An older
 * API sends none.
 */
function mergeTicketReadCursors(
  current: TicketReadCursors,
  incoming: Record<string, string> | null | undefined,
): TicketReadCursors {
  if (!incoming) return current;

  let next: Record<string, string> | null = null;

  for (const [ticketId, at] of Object.entries(incoming)) {
    if (typeof at !== "string" || !at) continue;

    const merged = laterIso(current[ticketId], at);

    if (merged !== current[ticketId]) {
      next = next ?? { ...current };
      next[ticketId] = merged as string;
    }
  }

  return next ?? current;
}

interface ChatReadCursors {
  /** The thread cursor (`counterpartLastReadAt`): the whole conversation. */
  thread: string | null;
  tickets: TicketReadCursors;
}

/**
 * A live `chatRead`. One with a `ticketId` is the tower reading THAT ticket
 * and moves only its cursor: marking the whole thread read turned other
 * subjects nobody opened blue. Without one it is the thread's (an older
 * panel). The driver's own reads never turn his checks blue.
 */
function applyChatRead(
  current: ChatReadCursors,
  event: { userId?: string; last_read_at?: string; ticketId?: string | null } | null | undefined,
  myUserId: string | null,
): ChatReadCursors {
  if (!event?.last_read_at) return current;

  if (event.userId && event.userId === myUserId) return current;

  if (event.ticketId) {
    const tickets = mergeTicketReadCursors(current.tickets, {
      [event.ticketId]: event.last_read_at,
    });

    return tickets === current.tickets ? current : { ...current, tickets };
  }

  const thread = laterIso(current.thread, event.last_read_at);

  return thread === current.thread ? current : { ...current, thread };
}

/**
 * The cursor that decides one message's blue check: the later of the
 * thread's and its ticket's. A message without a ticket (a mass notice, a
 * cached one from before the tickets) only has the thread's.
 */
function readCursorOf(
  message: { ticketId?: string | null } | null | undefined,
  cursors: ChatReadCursors,
): string | null {
  const ticketCursor = message?.ticketId ? cursors.tickets[message.ticketId] : undefined;

  return laterIso(cursors.thread, ticketCursor ?? null);
}

/** Where the next message goes when the chip names nothing (design §8.2). */
type ComposerTarget =
  | { kind: "chip" }
  | { kind: "ticket"; ticket: TicketLike; why: "reply" | "latest" }
  | { kind: "new" };

/**
 * The default subject of the composer (`defaultComposerTarget`, design §8.2):
 *  1. a chip the driver or a screen put up (delivery, route, ticket, push) wins;
 *  2. else the OPEN ticket of the central's newest message — he is answering it;
 *  3. else the OPEN ticket of the newest message at all;
 *  4. else a new subject (the API opens it).
 * `messages` is oldest first, as the screen holds it. A closed ticket is never
 * a default: writing in it would be refused.
 */
function defaultComposerTarget(input: {
  hasChip: boolean;
  messages: ReadonlyArray<{ senderId: string; ticketId?: string | null }>;
  myUserId: string | null;
  tickets: ReadonlyMap<string, TicketLike>;
}): ComposerTarget {
  if (input.hasChip) return { kind: "chip" };

  const openTicketOf = (message: { ticketId?: string | null }) => {
    const ticket = message.ticketId ? input.tickets.get(message.ticketId) : undefined;

    return ticket?.status === "OPEN" ? ticket : null;
  };

  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];

    if (message.senderId === input.myUserId) continue;

    const ticket = openTicketOf(message);

    if (ticket) return { kind: "ticket", ticket, why: "reply" };
  }

  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const ticket = openTicketOf(input.messages[index]);

    if (ticket) return { kind: "ticket", ticket, why: "latest" };
  }

  return { kind: "new" };
}

/**
 * The driver's open subjects for the sheet, newest number first, the one the
 * composer points at on top.
 */
function sheetTickets(
  tickets: ReadonlyArray<TicketLike>,
  currentTicketId: string | null,
): TicketLike[] {
  return tickets
    .filter((ticket) => ticket.status === "OPEN")
    .sort((a, b) => {
      if (a.id === currentTicketId) return -1;
      if (b.id === currentTicketId) return 1;

      return b.number - a.number;
    });
}

export {
  mergeTicketReadCursors,
  applyChatRead,
  readCursorOf,
  defaultComposerTarget,
  sheetTickets,
};
export type { ComposerTarget };
export type { TicketReadCursors, ChatReadCursors };

export {
  needsTicketSeparator,
  ticketSeparatorLabel,
  mergeTickets,
  applyTicketEvent,
  chipTicketClosed,
  ticketParamsOfPush,
};
export type { TicketLike, DriverTicketEvent };
