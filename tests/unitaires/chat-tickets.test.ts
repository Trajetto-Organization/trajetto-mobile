import { describe, expect, it } from "vitest";

import {
  applyChatRead,
  applyTicketEvent,
  chipTicketClosed,
  defaultComposerTarget,
  mergeTicketReadCursors,
  mergeTickets,
  needsTicketSeparator,
  readCursorOf,
  sheetTickets,
  ticketParamsOfPush,
  ticketSeparatorLabel,
  type ChatReadCursors,
  type TicketLike,
} from "@/features/chat/ticket-rules";
import {
  chatContextBody,
  chatContextFields,
  chatContextFromParams,
  chatContextLabel,
  chatContextParams,
  chatContextParamsKey,
  isStaleContextRejection,
  staleContextNotice,
  stripChatContext,
} from "@/features/chat/chat-context";

import type { ClientChatMessage } from "@/features/chat/types";

/** The driver's side of the support tickets (decision 14.5, design §8). */
const ticket = (overrides: Partial<TicketLike> = {}): TicketLike => ({
  id: "tk1",
  number: 128,
  status: "OPEN",
  subject: "Cliente ausente — Mercado Sol",
  version: 1,
  ...overrides,
});

describe("subject separators", () => {
  it("opens a subject where the ticket changes, never for a message without one", () => {
    expect(needsTicketSeparator(undefined, { ticketId: "tk1" })).toBe(true);
    expect(needsTicketSeparator({ ticketId: "tk1" }, { ticketId: "tk1" })).toBe(false);
    expect(needsTicketSeparator({ ticketId: "tk1" }, { ticketId: "tk2" })).toBe(true);

    // A mass notice, or a message cached before the tickets.
    expect(needsTicketSeparator({ ticketId: "tk1" }, { ticketId: null })).toBe(false);
    expect(needsTicketSeparator({ ticketId: "tk1" }, {})).toBe(false);
    expect(needsTicketSeparator({}, { ticketId: "tk1" })).toBe(true);
  });

  it("names the subject, and how it ended", () => {
    expect(ticketSeparatorLabel(ticket())).toBe("#128 · Cliente ausente — Mercado Sol");
    expect(ticketSeparatorLabel(ticket({ status: "CLOSED", close_outcome: "APPROVED" }))).toBe(
      "#128 · Cliente ausente — Mercado Sol — Atendimento encerrado · Autorizado: pode seguir",
    );
    expect(ticketSeparatorLabel(ticket({ status: "CLOSED", close_outcome: null }))).toBe(
      "#128 · Cliente ausente — Mercado Sol — Atendimento encerrado",
    );
    expect(ticketSeparatorLabel(undefined)).toBe("Assunto");
  });
});

describe("tickets learned from pages and events", () => {
  it("keeps the newest version: a late copy never reopens what closed", () => {
    let known = mergeTickets(new Map(), [ticket()]);

    known = applyTicketEvent(known, { type: "ticket.closed", ticket: ticket({ status: "CLOSED", version: 3 }) });
    known = mergeTickets(known, [ticket({ version: 2 })]);

    expect(known.get("tk1")?.status).toBe("CLOSED");

    known = applyTicketEvent(known, { type: "ticket.reopened", ticket: ticket({ version: 4 }) });

    expect(known.get("tk1")?.status).toBe("OPEN");
    expect(mergeTickets(known, undefined).size).toBe(1);
    expect(applyTicketEvent(known, null).size).toBe(1);
  });

  it("tells when the chip's ticket has closed", () => {
    const known = mergeTickets(new Map(), [ticket({ status: "CLOSED" })]);

    expect(chipTicketClosed("tk1", known)).toBe(true);
    expect(chipTicketClosed("tk2", known)).toBe(false);
    expect(chipTicketClosed(null, known)).toBe(false);
  });
});

describe("the composer's subject chip", () => {
  it("reads a ticket from the params, labels it, and writes into it", () => {
    const context = chatContextFromParams({
      ticketId: "tk1",
      ticketNumber: "128",
      ticketSubject: "Cliente ausente — Mercado Sol",
    });

    expect(context).toEqual({
      delivery: null,
      route: null,
      ticket: { id: "tk1", number: 128, subject: "Cliente ausente — Mercado Sol" },
    });
    expect(chatContextLabel(context!)).toBe("Assunto: #128 · Cliente ausente — Mercado Sol");

    // The ticket names its own delivery and route on the server.
    const fields = chatContextFields(context);

    expect(fields.ticketId).toBe("tk1");
    expect(chatContextBody({ ...fields, deliveryId: "e1" })).toEqual({ ticketId: "tk1" });

    // Round trip through the tab's params, and a new tap is a new key.
    expect(chatContextFromParams(chatContextParams(context!, 1))).toEqual(context);
    expect(chatContextParamsKey(chatContextParams(context!, 1))).not.toBe(
      chatContextParamsKey(chatContextParams({ ...context!, ticket: { ...context!.ticket!, id: "tk2" } }, 1)),
    );
  });

  it("labels a ticket the push named without its number", () => {
    const context = chatContextFromParams({ ticketId: "tk1" });

    expect(chatContextLabel(context!)).toBe("Assunto: Atendimento");
  });

  it("keeps a delivery chip exactly as before the tickets", () => {
    expect(chatContextFromParams({ deliveryId: "e1", recipient: "Padaria" })).toEqual({
      delivery: { id: "e1", recipient: "Padaria" },
      route: null,
    });
  });
});

describe("a closed ticket on send", () => {
  const sent = {
    deliveryId: null,
    routeId: null,
    ticketId: "tk1",
  };

  it("is a stale reference: the words go again without the ticket", () => {
    expect(isStaleContextRejection({ code: "SUPPORT_TICKET_CLOSED" }, sent)).toBe(true);
    expect(isStaleContextRejection({ code: "SUPPORT_TICKET_NOT_FOUND" }, sent)).toBe(true);
    expect(isStaleContextRejection({ code: "SUPPORT_TICKET_CLOSED" }, { deliveryId: null, routeId: null })).toBe(false);
    expect(isStaleContextRejection({ code: "VALIDATION_ERROR" }, sent)).toBe(false);

    const list = [{ client_submission_id: "s1", ...chatContextFields({ delivery: null, route: null, ticket: { id: "tk1", number: 1, subject: "x" } }) }] as ClientChatMessage[];

    expect(stripChatContext(list, "s1")[0].ticketId).toBeNull();
  });

  it("tells the driver why, in the ticket's words", () => {
    expect(staleContextNotice({ code: "SUPPORT_TICKET_CLOSED" }).title).toBe("Atendimento encerrado");
    expect(staleContextNotice({ code: "CHAT_DELIVERY_NOT_FOUND" }).title).toBe("Referência removida");
  });
});

describe("a chat push", () => {
  it("opens the chat on the ticket it names", () => {
    expect(ticketParamsOfPush({ url: "chat", ticketId: "tk1", ticketNumber: 128, ticketSubject: "Avaria" })).toMatchObject({
      ticketId: "tk1",
      ticketNumber: "128",
      ticketSubject: "Avaria",
    });
    expect(ticketParamsOfPush({ ticketId: " " })).toBeNull();
    expect(ticketParamsOfPush({ url: "chat" })).toBeNull();
    expect(ticketParamsOfPush(null)).toBeNull();
    expect(ticketParamsOfPush({ ticketId: "tk1", ticketNumber: "x" })?.ticketNumber).toBe("");
  });
});

describe("the driver's blue check per ticket (review round 2)", () => {
  const T1 = "2026-10-05T10:00:00.000Z";
  const T2 = "2026-10-05T10:05:00.000Z";
  const empty: ChatReadCursors = { thread: null, tickets: {} };

  it("marks read only the messages of the ticket the central read, live", () => {
    // The central opened ticket #1 only: the event names it.
    const after = applyChatRead(
      empty,
      { userId: "agent", last_read_at: T2, ticketId: "tk1" },
      "driver-user",
    );

    expect(after).toEqual({ thread: null, tickets: { tk1: T2 } });

    expect(readCursorOf({ ticketId: "tk1" }, after)).toBe(T2);
    // Another subject nobody opened stays unread (it used to turn blue).
    expect(readCursorOf({ ticketId: "tk2" }, after)).toBeNull();
    // A mass notice or a pre-ticket message only knows the thread cursor.
    expect(readCursorOf({ ticketId: null }, after)).toBeNull();
  });

  it("still reads the whole thread from an event without a ticket, and ignores the driver's own reads", () => {
    const thread = applyChatRead(empty, { userId: "agent", last_read_at: T1 }, "driver-user");

    expect(thread.thread).toBe(T1);
    expect(readCursorOf({ ticketId: "tk2" }, thread)).toBe(T1);

    expect(
      applyChatRead(empty, { userId: "driver-user", last_read_at: T2, ticketId: "tk1" }, "driver-user"),
    ).toBe(empty);
    expect(applyChatRead(empty, { userId: "agent" }, "driver-user")).toBe(empty);
  });

  it("takes the page's cursors after a reload, advance-only", () => {
    const fromPage = mergeTicketReadCursors({}, { tk1: T2 });

    expect(fromPage).toEqual({ tk1: T2 });
    // An older snapshot never rewinds what a live event already applied.
    expect(mergeTicketReadCursors(fromPage, { tk1: T1 })).toBe(fromPage);
    // An API older than the cursors sends none.
    expect(mergeTicketReadCursors(fromPage, undefined)).toBe(fromPage);

    // The later of the thread and the ticket cursor decides.
    expect(readCursorOf({ ticketId: "tk1" }, { thread: T1, tickets: fromPage })).toBe(T2);
    expect(readCursorOf({ ticketId: "tk1" }, { thread: T2, tickets: { tk1: T1 } })).toBe(T2);
  });
});

describe("the composer's default subject (design §8.2)", () => {
  const open = (id: string, number: number): TicketLike => ({
    id,
    number,
    status: "OPEN",
    subject: `Assunto ${number}`,
    version: 1,
  });
  const closed = (id: string, number: number): TicketLike => ({ ...open(id, number), status: "CLOSED" });

  const tickets = new Map<string, TicketLike>([
    ["tk1", open("tk1", 1)],
    ["tk2", open("tk2", 2)],
    ["tk3", closed("tk3", 3)],
  ]);

  it("keeps an explicit chip", () => {
    expect(
      defaultComposerTarget({ hasChip: true, messages: [], myUserId: "me", tickets }),
    ).toEqual({ kind: "chip" });
  });

  it("answers the open ticket the central last wrote in, even if the driver wrote elsewhere since", () => {
    expect(
      defaultComposerTarget({
        hasChip: false,
        messages: [
          { senderId: "agent", ticketId: "tk1" },
          { senderId: "me", ticketId: "tk2" },
        ],
        myUserId: "me",
        tickets,
      }),
    ).toEqual({ kind: "ticket", ticket: tickets.get("tk1"), why: "reply" });
  });

  it("never defaults to a closed ticket: the newest open one, else a new subject", () => {
    expect(
      defaultComposerTarget({
        hasChip: false,
        messages: [
          { senderId: "me", ticketId: "tk2" },
          { senderId: "agent", ticketId: "tk3" },
        ],
        myUserId: "me",
        tickets,
      }),
    ).toEqual({ kind: "ticket", ticket: tickets.get("tk2"), why: "latest" });

    expect(
      defaultComposerTarget({
        hasChip: false,
        messages: [{ senderId: "agent", ticketId: "tk3" }, { senderId: "agent", ticketId: null }],
        myUserId: "me",
        tickets,
      }),
    ).toEqual({ kind: "new" });
  });

  it("lists the open subjects in the sheet, the current one first", () => {
    expect(sheetTickets([...tickets.values()], "tk1").map((ticket) => ticket.id)).toEqual([
      "tk1",
      "tk2",
    ]);
    expect(sheetTickets([...tickets.values()], null).map((ticket) => ticket.id)).toEqual([
      "tk2",
      "tk1",
    ]);
  });
});
