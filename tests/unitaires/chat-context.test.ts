import { describe, expect, it } from "vitest";

import {
  chatContextBody,
  chatContextFields,
  chatContextFromParams,
  chatContextLabel,
  chatContextOfDelivery,
  chatContextOfRoute,
  chatContextParams,
  chatContextParamsKey,
  chatRouteLabel,
  composeImageBatch,
  citesRefusedContext,
  rememberRefusedContext,
  stripChatContext,
  isStaleContextRejection,
  linkedMessagesPreview,
} from "@/features/chat/chat-context";

import type { ClientChatMessage } from "@/features/chat/types";

/**
 * The context a driver's message carries (decision 6.7; DLVP-CHAT-1).
 *
 * One conversation per driver; each message may name the delivery and the
 * route it is about, so the panel shows a delivery's or a route's messages.
 * Before: the app sent only the delivery, only on the first message after the
 * chip was set, and never a route.
 */

const DELIVERY = "0192b1c4-0000-4000-8000-000000000001";
const ROUTE = "0192b1c4-0000-4000-8000-0000000000aa";

const deliveryWithStop = {
  id: DELIVERY,
  recipient_name: "Mercado Central",
  stops: [{ route: { id: ROUTE, code: 42, name: "Zona Sul" } }],
};

function message(overrides: Partial<ClientChatMessage> = {}): ClientChatMessage {
  return {
    id: "local-sub-1",
    kind: "TEXT",
    body: "Cliente ausente",
    attachment_url: null,
    duration_ms: null,
    deliveryId: null,
    broadcast_id: null,
    client_submission_id: "sub-1",
    threadId: "thread-1",
    senderId: "user-driver",
    sender: { id: "user-driver", name: "Motorista" },
    delivery: null,
    created_at: "2026-09-29T12:00:00.000Z",
    pending: true,
    ...overrides,
  };
}

describe("opening the chat from a screen", () => {
  it("carries a delivery and the route of its open stop", () => {
    const context = chatContextOfDelivery(deliveryWithStop);

    expect(context).toEqual({
      delivery: { id: DELIVERY, recipient: "Mercado Central" },
      route: { id: ROUTE, code: 42, name: "Zona Sul" },
    });
  });

  it("carries only the delivery when it is on no route", () => {
    expect(
      chatContextOfDelivery({ ...deliveryWithStop, stops: [] }).route,
    ).toBeNull();

    // Cached payloads written before `stops` existed have no key at all.
    expect(
      chatContextOfDelivery({ id: DELIVERY, recipient_name: "Mercado Central" })
        .route,
    ).toBeNull();
  });

  it("round-trips through the router params", () => {
    const context = chatContextOfDelivery(deliveryWithStop);

    expect(chatContextFromParams(chatContextParams(context, 1))).toEqual(context);

    const routeOnly = chatContextOfRoute({ id: ROUTE, code: 7, name: null });

    expect(chatContextFromParams(chatContextParams(routeOnly, 2))).toEqual(
      routeOnly,
    );
  });

  it("sends every key, so a key from the previous visit cannot leak in", () => {
    // The tab is already mounted: params a route chip left behind must be
    // overwritten by a delivery chip without a route, not merged into it.
    const params = chatContextParams(
      chatContextOfDelivery({ id: DELIVERY, recipient_name: "Mercado Central" }),
      3,
    );

    expect(params).toEqual({
      deliveryId: DELIVERY,
      recipient: "Mercado Central",
      routeId: "",
      routeCode: "",
      routeName: "",
      // Decision 14.5: a ticket chip left behind is overwritten too.
      ticketId: "",
      ticketNumber: "",
      ticketSubject: "",
      contextAt: "3",
    });

    expect(chatContextFromParams(params)?.route).toBeNull();
  });

  it("ignores half-filled params instead of showing a broken chip", () => {
    expect(chatContextFromParams({})).toBeNull();
    expect(chatContextFromParams({ deliveryId: DELIVERY })).toBeNull();
    expect(chatContextFromParams({ routeId: ROUTE, routeCode: "abc" })).toBeNull();
    expect(chatContextFromParams({ routeId: ROUTE, routeCode: "" })).toBeNull();

    // A repeated param arrives as an array; the first value counts.
    expect(
      chatContextFromParams({
        deliveryId: [DELIVERY, "other"],
        recipient: ["Mercado Central"],
      })?.delivery,
    ).toEqual({ id: DELIVERY, recipient: "Mercado Central" });
  });

  it("changes its key on every tap, even for the same delivery", () => {
    const context = chatContextOfDelivery(deliveryWithStop);

    const first = chatContextParamsKey(chatContextParams(context, 100));
    const again = chatContextParamsKey(chatContextParams(context, 200));

    expect(first).not.toBe(again);
    expect(chatContextParamsKey({})).toBe(chatContextParamsKey({}));
  });
});

describe("what the chip and the bubble read", () => {
  it("names the delivery and its route, or the route alone", () => {
    expect(chatContextLabel(chatContextOfDelivery(deliveryWithStop))).toBe(
      "Sobre a entrega: Mercado Central · Rota 42",
    );

    expect(
      chatContextLabel(chatContextOfRoute({ id: ROUTE, code: 42, name: "Zona Sul" })),
    ).toBe("Sobre a Rota 42 · Zona Sul");

    expect(chatRouteLabel({ code: 9, name: null })).toBe("Rota 9");
  });
});

describe("what the message carries", () => {
  it("shows the delivery and the route on the optimistic bubble", () => {
    expect(chatContextFields(chatContextOfDelivery(deliveryWithStop))).toEqual({
      deliveryId: DELIVERY,
      delivery: { id: DELIVERY, recipient_name: "Mercado Central", status: "" },
      routeId: ROUTE,
      route: { id: ROUTE, code: 42, name: "Zona Sul" },
      ticketId: null,
    });

    expect(chatContextFields(null)).toEqual({
      deliveryId: null,
      delivery: null,
      routeId: null,
      route: null,
      ticketId: null,
    });
  });

  it("tells the API the delivery alone, which tags its route itself", () => {
    // The API resolves the route that carries the delivery, fresher than the
    // route a seven-day cache remembers for it.
    expect(
      chatContextBody(
        chatContextFields(chatContextOfDelivery(deliveryWithStop)),
      ),
    ).toEqual({ deliveryId: DELIVERY });
  });

  it("tells the API the route when the message is about the route", () => {
    expect(
      chatContextBody(
        chatContextFields(chatContextOfRoute({ id: ROUTE, code: 42, name: null })),
      ),
    ).toEqual({ routeId: ROUTE });

    expect(chatContextBody({ deliveryId: null, routeId: null })).toEqual({});
  });

  it("puts the context on every photo and the caption on the last", () => {
    const context = chatContextOfDelivery(deliveryWithStop);

    const batch = composeImageBatch(
      [{ uri: "file:///a.jpg" }, { uri: "file:///b.jpg" }, { uri: "file:///c.jpg" }],
      "Avaria na caixa",
      context,
    );

    expect(batch.map((item) => item.context)).toEqual([context, context, context]);
    expect(batch.map((item) => item.body)).toEqual([
      undefined,
      undefined,
      "Avaria na caixa",
    ]);
    expect(batch.map((item) => item.uri)).toEqual([
      "file:///a.jpg",
      "file:///b.jpg",
      "file:///c.jpg",
    ]);

    expect(composeImageBatch([{ uri: "file:///a.jpg" }], "", null)[0]).toMatchObject({
      body: undefined,
      context: null,
    });
  });
});

describe("a reference the API no longer accepts", () => {
  const withDelivery = { deliveryId: DELIVERY, routeId: null };

  it("is recognised by the chat's own codes, only for a message that cites one", () => {
    expect(isStaleContextRejection({ code: "CHAT_DELIVERY_NOT_FOUND" }, withDelivery)).toBe(true);
    expect(
      isStaleContextRejection({ code: "CHAT_ROUTE_NOT_FOUND" }, { deliveryId: null, routeId: ROUTE }),
    ).toBe(true);
    expect(
      isStaleContextRejection({ code: "CHAT_ROUTE_OTHER_DRIVER" }, { deliveryId: null, routeId: ROUTE }),
    ).toBe(true);

    // Any other refusal is not fixed by dropping the chip.
    expect(isStaleContextRejection({ code: "CHAT_DRIVER_NOT_FOUND" }, withDelivery)).toBe(false);
    expect(isStaleContextRejection({ status: 404 }, withDelivery)).toBe(false);
    expect(isStaleContextRejection(new Error("offline"), withDelivery)).toBe(false);

    // A message without context cannot be refused for it.
    expect(
      isStaleContextRejection(
        { code: "CHAT_DELIVERY_NOT_FOUND" },
        { deliveryId: null, routeId: null },
      ),
    ).toBe(false);
  });

  it("keeps the words and their send state, and drops only the reference", () => {
    const cited = message({
      ...chatContextFields(chatContextOfDelivery(deliveryWithStop)),
    });
    const other = message({
      id: "local-sub-2",
      client_submission_id: "sub-2",
      ...chatContextFields(chatContextOfDelivery(deliveryWithStop)),
    });

    const [stripped, untouched] = stripChatContext([cited, other], "sub-1");

    expect(stripped).toMatchObject({
      body: "Cliente ausente",
      client_submission_id: "sub-1",
      // Still on its way: it is about to go again, without the reference.
      pending: true,
      deliveryId: null,
      delivery: null,
      routeId: null,
      route: null,
    });

    expect(untouched).toBe(other);
  });

  it("remembers what the API was told, so the rest of the batch does not cite it", () => {
    const refused = new Set<string>();

    // A delivery chip sends the delivery alone: that is what was refused.
    rememberRefusedContext(
      refused,
      chatContextFields(chatContextOfDelivery(deliveryWithStop)),
    );

    expect([...refused]).toEqual([DELIVERY]);

    expect(
      citesRefusedContext(chatContextFields(chatContextOfDelivery(deliveryWithStop)), refused),
    ).toBe(true);

    // The route itself was never refused: a message about it still goes.
    expect(
      citesRefusedContext(
        chatContextFields(chatContextOfRoute({ id: ROUTE, code: 42, name: null })),
        refused,
      ),
    ).toBe(false);

    expect(citesRefusedContext({ deliveryId: null, routeId: null }, refused)).toBe(false);
  });
});

describe("the delivery's own messages, on its detail screen", () => {
  it("reads oldest first, names the driver as 'Você' and says what a media message is", () => {
    const page = [
      message({
        id: "m3",
        kind: "AUDIO",
        body: null,
        senderId: "user-agent",
        sender: { id: "user-agent", name: "Central Norte" },
        created_at: "2026-09-29T12:03:00.000Z",
      }),
      message({
        id: "m2",
        kind: "IMAGE",
        body: "  ",
        created_at: "2026-09-29T12:02:00.000Z",
      }),
      message({
        id: "m1",
        body: "Cliente pediu para deixar na portaria",
        senderId: "user-agent",
        sender: { id: "user-agent", name: " " },
        created_at: "2026-09-29T12:01:00.000Z",
      }),
    ];

    // The API answers newest first.
    expect(linkedMessagesPreview(page, "user-driver")).toEqual([
      {
        id: "m1",
        who: "Central",
        text: "Cliente pediu para deixar na portaria",
        at: "2026-09-29T12:01:00.000Z",
      },
      { id: "m2", who: "Você", text: "Foto", at: "2026-09-29T12:02:00.000Z" },
      {
        id: "m3",
        who: "Central Norte",
        text: "Mensagem de voz",
        at: "2026-09-29T12:03:00.000Z",
      },
    ]);
  });
});
