import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  approvalNoteOfPushBody,
  authorizationView,
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
} from "@/features/occurrences/authorization-rules";
import type { DriverAuthorizationRequest } from "@/features/deliveries/types";

/**
 * The tower's authorization of an occurrence, as the driver sees it
 * (decision 6.3; docs/contratos-app/occurrences.md §3–§5): what the stop says
 * while it waits, what the driver is told when the answer comes, and how the
 * cached day changes with it.
 */

const REQUEST: DriverAuthorizationRequest = {
  occurrenceId: "occ-1",
  occurrenceTypeId: "type-ausente",
  occurrenceTypeName: "Cliente ausente",
  status: "PENDING",
  note: null,
  decidedAt: null,
  requestedAt: "2026-09-29T15:02:11.000Z",
};

const delivery = (overrides: Record<string, unknown> = {}) => ({
  id: "delivery-1",
  recipient_name: "Mercado Central",
  status: "IN_TRANSIT",
  authorization_request: REQUEST,
  ...overrides,
});

const clock = () => "12:02";

describe("the answer's frames", () => {
  it("reads the socket's decision, and nothing else as one", () => {
    const event = {
      type: "occurrence.authorization_decided",
      deliveryId: "delivery-1",
      occurrenceId: "occ-1",
      decision: "DENIED",
      note: "Aguarde o cliente.",
      deliveryStatus: "IN_TRANSIT",
    };

    expect(isOccurrenceDecisionEvent(event)).toBe(true);
    expect(isOccurrenceDecisionEvent({ ...event, decision: "MAYBE" })).toBe(false);
    expect(
      isOccurrenceDecisionEvent({
        type: "delivery.status_overridden",
        deliveryId: "delivery-1",
        status: "CANCELLED",
        removedFromWorklist: true,
      }),
    ).toBe(false);
    expect(isOccurrenceDecisionEvent(null)).toBe(false);
  });

  it("reads the push without trusting data.deliveryId, which the pipeline overwrites", () => {
    const push = occurrenceDecisionOfPush({
      title: "⛔ Ocorrência não autorizada",
      body: "Cliente ausente — Mercado Central: Aguarde o cliente.",
      data: {
        url: "/deliveries",
        deliveryId: "notification-delivery-row",
        occurrenceId: "occ-1",
        decision: "DENIED",
      },
    });

    expect(push).toEqual({
      occurrenceId: "occ-1",
      decision: "DENIED",
      entityId: null,
      deliveryStatus: null,
      title: "⛔ Ocorrência não autorizada",
      body: "Cliente ausente — Mercado Central: Aguarde o cliente.",
    });

    // The status after the decision, once the API puts it in the push.
    expect(
      occurrenceDecisionOfPush({
        data: { occurrenceId: "occ-1", decision: "APPROVED", deliveryStatus: "FAILED" },
      })?.deliveryStatus,
    ).toBe("FAILED");
    expect(
      occurrenceDecisionOfPush({ data: { occurrenceId: "occ-1", decision: "APPROVED", deliveryStatus: 3 } })
        ?.deliveryStatus,
    ).toBeNull();

    // Any other push is not an answer.
    expect(occurrenceDecisionOfPush({ data: { url: "/chat" } })).toBeNull();
    expect(occurrenceDecisionOfPush({ data: { occurrenceId: "occ-1" } })).toBeNull();
    expect(occurrenceDecisionOfPush(undefined)).toBeNull();
  });

  describe("the delivery's status after the answer", () => {
    const BLOCKING = [{ id: "type-ausente", blocks_delivery: true }];
    const answer = (overrides: Record<string, unknown> = {}) => ({
      occurrenceId: "occ-1",
      decision: "APPROVED" as const,
      deliveryStatus: null as string | null,
      ...overrides,
    });

    it("is the road's when it says it", () => {
      expect(statusAfterDecision(answer({ deliveryStatus: "IN_TRANSIT" }), delivery(), BLOCKING)).toBe(
        "IN_TRANSIT",
      );
    });

    it("an approval of a type the day knows as blocking failed the delivery", () => {
      expect(statusAfterDecision(answer(), delivery(), BLOCKING)).toBe("FAILED");
    });

    it("unknown otherwise: a denial, a type that does not block, a type or delivery the day does not know", () => {
      expect(statusAfterDecision(answer({ decision: "DENIED" }), delivery(), BLOCKING)).toBeNull();
      expect(
        statusAfterDecision(answer(), delivery(), [{ id: "type-ausente", blocks_delivery: false }]),
      ).toBeNull();
      expect(statusAfterDecision(answer(), delivery(), [])).toBeNull();
      expect(statusAfterDecision(answer(), null, BLOCKING)).toBeNull();
    });

    it("only from the request the answer is about", () => {
      // Found by the id it names, but its request is another one.
      expect(statusAfterDecision(answer({ occurrenceId: "occ-9" }), delivery(), BLOCKING)).toBeNull();
    });
  });

  it("finds the delivery by the request it answers, then by the id it names", () => {
    const day = [delivery(), delivery({ id: "delivery-2", authorization_request: null })];

    expect(decidedDeliveryOf(day, { occurrenceId: "occ-1", deliveryId: "junk" })?.id).toBe(
      "delivery-1",
    );
    expect(decidedDeliveryOf(day, { occurrenceId: "occ-9", deliveryId: "delivery-2" })?.id).toBe(
      "delivery-2",
    );
    expect(decidedDeliveryOf(day, { occurrenceId: "occ-9", deliveryId: null })).toBeNull();
  });
});

describe("what the driver is told, and what to do next", () => {
  it("a denial gives the tower's reason and keeps the delivery in route", () => {
    expect(
      decisionNotice(
        { decision: "DENIED", note: "Aguarde o cliente até 15h", deliveryStatus: "IN_TRANSIT" },
        delivery(),
      ),
    ).toEqual({
      type: "error",
      title: "Ocorrência não autorizada",
      message:
        "Mercado Central: Aguarde o cliente até 15h. A entrega continua em rota: siga a orientação da torre ou fale com a base.",
    });
  });

  it("an approval that failed the delivery sends the driver on", () => {
    expect(
      decisionNotice({ decision: "APPROVED", note: null, deliveryStatus: "FAILED" }, delivery()),
    ).toEqual({
      type: "success",
      title: "Ocorrência autorizada",
      message: "Mercado Central: entrega registrada como Insucesso. Siga para a próxima parada.",
    });
  });

  it("an approval that keeps the delivery says to go on with it, with the tower's words", () => {
    expect(
      decisionNotice(
        { decision: "APPROVED", note: "Deixe com o porteiro e comprove.", deliveryStatus: "IN_TRANSIT" },
        delivery(),
      ).message,
    ).toBe("Mercado Central: pode seguir com a entrega. Deixe com o porteiro e comprove.");
  });

  it("without the row, still says something the driver can use", () => {
    expect(decisionNotice({ decision: "DENIED", note: null }, null).message).toBe(
      "Sua entrega: a torre negou o pedido. A entrega continua em rota: siga a orientação da torre ou fale com a base.",
    );
  });
});

// Before: the foreground toast repeated the API's body, which says "pode
// seguir" for every approval — while the stop said the delivery ended.
describe("the toast of a decision push received with the app open", () => {
  const push = (decision: "APPROVED" | "DENIED", body: string | null) => ({
    decision,
    title: decision === "APPROVED" ? "✅ Ocorrência autorizada" : "⛔ Ocorrência não autorizada",
    body,
  });

  const endedNotice = decisionNotice(
    { decision: "APPROVED", note: null, deliveryStatus: "FAILED" },
    delivery(),
  );

  it("an approval that ended the delivery says so, with the tower's note from the body", () => {
    expect(
      decisionPushNotice(
        push("APPROVED", "Cliente ausente — Mercado Central: pode seguir. Devolva à base"),
        endedNotice,
        "FAILED",
      ),
    ).toEqual({
      type: "success",
      title: "✅ Ocorrência autorizada",
      message:
        "Mercado Central: entrega registrada como Insucesso. Siga para a próxima parada. Devolva à base.",
    });

    expect(
      decisionPushNotice(
        push("APPROVED", "Cliente ausente — Mercado Central: pode seguir."),
        endedNotice,
        "FAILED",
      ).message,
    ).toBe("Mercado Central: entrega registrada como Insucesso. Siga para a próxima parada.");
  });

  it("otherwise, the push's own words: they carry the tower's reason", () => {
    const openNotice = decisionNotice({ decision: "APPROVED", note: null }, delivery());

    expect(
      decisionPushNotice(
        push("APPROVED", "Cliente ausente — Mercado Central: pode seguir. Deixe na portaria."),
        openNotice,
        null,
      ).message,
    ).toBe("Cliente ausente — Mercado Central: pode seguir. Deixe na portaria.");

    const denied = decisionNotice({ decision: "DENIED", note: null }, delivery());

    expect(
      decisionPushNotice(push("DENIED", "Cliente ausente — Mercado Central: Aguarde."), denied, "IN_TRANSIT"),
    ).toEqual({
      type: "error",
      title: "⛔ Ocorrência não autorizada",
      message: "Cliente ausente — Mercado Central: Aguarde.",
    });

    expect(decisionPushNotice(push("APPROVED", null), openNotice, null).message).toBe(
      openNotice.message,
    );
  });

  // The note is read from the body the API renders (contract §5). A change
  // of wording there silently drops the note from this toast: caught here
  // when the API is checked out next to the app.
  const API_POLICY = resolve(
    __dirname,
    "../../../trajetto-api/src/shared/notifications/policies/delivery-occurrence-policy.ts",
  );

  it.skipIf(!existsSync(API_POLICY))("matches the approval body the API renders", () => {
    const policy = readFileSync(API_POLICY, "utf8");

    expect(policy).toContain(
      "`${payload.occurrenceTypeName} — ${payload.recipientName}: pode seguir.` +",
    );
    expect(policy).toContain('(payload.note ? ` ${payload.note}` : "")');
  });

  it("reads the note the contract's way, and nothing from a body worded otherwise", () => {
    expect(approvalNoteOfPushBody("Tipo — Destino: pode seguir. Deixe com o porteiro.")).toBe(
      "Deixe com o porteiro.",
    );
    expect(approvalNoteOfPushBody("Tipo — Destino: pode seguir.")).toBeNull();
    expect(approvalNoteOfPushBody("Tipo — Destino: entrega registrada como Insucesso.")).toBeNull();
    expect(approvalNoteOfPushBody(null)).toBeNull();
    expect(approvalNoteOfPushBody(undefined)).toBeNull();
  });
});

describe("the cached day", () => {
  it("takes the answer on the request it answers", () => {
    const [changed, other] = withDecision(
      [delivery(), delivery({ id: "delivery-2", authorization_request: { ...REQUEST, occurrenceId: "occ-2" } })],
      { occurrenceId: "occ-1", decision: "DENIED", note: "Não", decidedAt: "2026-09-29T15:10:00.000Z" },
    );

    expect(changed.authorization_request).toEqual({
      ...REQUEST,
      status: "DENIED",
      note: "Não",
      decidedAt: "2026-09-29T15:10:00.000Z",
    });
    expect(other.authorization_request?.status).toBe("PENDING");
  });

  it("keeps the note it had when the answer carries none (a push)", () => {
    const [changed] = withDecision([delivery({ authorization_request: { ...REQUEST, note: "antes" } })], {
      occurrenceId: "occ-1",
      decision: "APPROVED",
      decidedAt: "2026-09-29T15:10:00.000Z",
    });

    expect(changed.authorization_request?.note).toBe("antes");
  });

  it("never brings back a request the proof already superseded", () => {
    const superseded = delivery({ authorization_request: { ...REQUEST, status: "SUPERSEDED" } });

    expect(
      withDecision([superseded], {
        occurrenceId: "occ-1",
        decision: "APPROVED",
        decidedAt: "2026-09-29T15:10:00.000Z",
      })[0],
    ).toBe(superseded);
  });

  it("shows a request just filed before the refetch lands", () => {
    const [filed, untouched] = withAuthorizationRequested(
      [delivery({ authorization_request: null }), delivery({ id: "delivery-2", authorization_request: null })],
      "delivery-1",
      REQUEST,
    );

    expect(filed.authorization_request).toEqual(REQUEST);
    expect(untouched.authorization_request).toBeNull();
  });
});

describe("the report's answer (201)", () => {
  it("reads the authorization status, defaulting to 'no authorization'", () => {
    expect(
      sentReportOf({ message: "x", data: { id: "occ-1", authorization_status: "PENDING", replayed: false } }),
    ).toEqual({ occurrenceId: "occ-1", status: "PENDING" });
    expect(sentReportOf({ data: { id: "occ-1", authorization_status: "NOT_REQUIRED" } }).status).toBe(
      "NOT_REQUIRED",
    );
    expect(sentReportOf(undefined)).toEqual({ occurrenceId: null, status: "NOT_REQUIRED" });
  });

  it("says each outcome the contract's way", () => {
    expect(sentReportNotice("PENDING")).toEqual({
      title: "Ocorrência registrada",
      message: "Aguardando autorização da torre. A resposta chega aqui e por notificação.",
    });
    expect(sentReportNotice("SUPERSEDED").message).toBe(
      "A entrega já estava resolvida, então não há o que autorizar.",
    );
    expect(sentReportNotice("NOT_REQUIRED").title).toBe("Ocorrência registrada com sucesso!");
  });
});

describe("the stop's state", () => {
  it("waits for the tower, and says the proof is still open", () => {
    expect(authorizationView({ delivery: delivery(), formatTime: clock })).toEqual({
      tone: "waiting",
      title: "Aguardando autorização da torre",
      message: "Cliente ausente · pedido às 12:02",
      nextStep:
        "A resposta chega aqui e por notificação. Se conseguir entregar enquanto espera, toque em Entregar: a comprovação vale.",
    });
  });

  it("shows a denial with the reason and what to do", () => {
    expect(
      authorizationView({
        delivery: delivery({ authorization_request: { ...REQUEST, status: "DENIED", note: "Aguarde." } }),
      }),
    ).toMatchObject({
      tone: "denied",
      title: "Ocorrência não autorizada",
      message: "Cliente ausente: Aguarde.",
      nextStep: "A entrega continua em rota. Siga a orientação da torre ou fale com a base.",
    });
  });

  it("shows an approval", () => {
    expect(
      authorizationView({ delivery: delivery({ authorization_request: { ...REQUEST, status: "APPROVED" } }) }),
    ).toMatchObject({ tone: "approved", title: "Ocorrência autorizada", nextStep: "Pode seguir com a entrega." });
  });

  it("says nothing without a request, or after the attempt ended another way", () => {
    expect(authorizationView({ delivery: delivery({ authorization_request: null }) })).toBeNull();
    expect(authorizationView({ delivery: delivery({ authorization_request: undefined }) })).toBeNull();
    expect(
      authorizationView({ delivery: delivery({ authorization_request: { ...REQUEST, status: "SUPERSEDED" } }) }),
    ).toBeNull();
  });

  const queued = (overrides: Record<string, unknown> = {}) => ({
    kind: "delivery-occurrence",
    status: "pending",
    endpoint: "/delivery/report-occurrence/delivery-1/business/business-1",
    body: { occurrenceTypeId: "type-ausente" },
    createdAt: "2026-09-29T15:20:00.000Z",
    ...overrides,
  });

  it("a report still on the phone comes first, and says the tower gets it with signal", () => {
    expect(
      authorizationView({
        delivery: delivery(),
        queue: [queued()],
        occurrenceTypes: [{ id: "type-ausente", requires_authorization: true }],
      }),
    ).toEqual({
      tone: "queued",
      title: "Pedido de autorização salvo no aparelho",
      message: null,
      nextStep: "Vai para a torre quando houver conexão.",
      secondary: "Pedido anterior (Cliente ausente) aguardando autorização da torre.",
    });

    expect(
      authorizationView({ delivery: delivery({ authorization_request: null }), queue: [queued()] }),
    ).toMatchObject({ tone: "queued", title: "Ocorrência salva no aparelho" });
  });

  it("a report the company refused over its form points at the review", () => {
    expect(
      authorizationView({
        delivery: delivery(),
        queue: [queued({ status: "failed", failureCode: "OCCURRENCE_FORM_OUTDATED" })],
      }),
    ).toMatchObject({
      tone: "attention",
      title: "Ocorrência não enviada",
      nextStep: "Abra Envios pendentes e toque em Revisar formulário.",
    });
  });

  // Before: any queued item of the stop won, so an older report still failed
  // on the phone hid a request the driver filed afterwards, online, and the
  // stop never said "Aguardando autorização da torre".
  it("a request filed after a report still failed on the phone is what the stop shows", () => {
    const olderFailure = queued({
      status: "failed",
      failureCode: "OCCURRENCE_FORM_OUTDATED",
      createdAt: "2026-09-29T14:50:00.000Z",
    });

    expect(
      authorizationView({ delivery: delivery(), queue: [olderFailure], formatTime: clock }),
    ).toEqual({
      tone: "waiting",
      title: "Aguardando autorização da torre",
      message: "Cliente ausente · pedido às 12:02",
      nextStep:
        "A resposta chega aqui e por notificação. Se conseguir entregar enquanto espera, toque em Entregar: a comprovação vale.",
      secondary: "Uma ocorrência anterior não foi enviada: veja em Envios pendentes.",
    });
  });

  it("an older report still waiting for signal is mentioned under a newer request", () => {
    expect(
      authorizationView({
        delivery: delivery(),
        queue: [queued({ createdAt: "2026-09-29T14:50:00.000Z" })],
      }),
    ).toMatchObject({
      tone: "waiting",
      secondary: "Uma ocorrência anterior ainda está salva no aparelho.",
    });
  });

  it("a report queued after the request, or with no request to compare, is what the stop shows", () => {
    // Same instant: the phone's own report is the newer word.
    expect(
      authorizationView({
        delivery: delivery(),
        queue: [queued({ status: "failed", failureCode: "OCCURRENCE_FORM_OUTDATED", createdAt: REQUEST.requestedAt })],
      }),
    ).toMatchObject({ tone: "attention", title: "Ocorrência não enviada" });

    // A request the attempt outgrew says nothing, so it cannot hide the queue.
    expect(
      authorizationView({
        delivery: delivery({ authorization_request: { ...REQUEST, status: "SUPERSEDED" } }),
        queue: [queued({ createdAt: "2026-09-29T14:50:00.000Z" })],
      }),
    ).toMatchObject({ tone: "queued" });
  });

  // Before: a newer report on the phone hid the day's live request
  // entirely — a PENDING the tower may still answer, or a DENIED whose
  // reason the driver was told to follow.
  it("a newer report on the phone keeps the live request in a second line", () => {
    const newerFailure = queued({ status: "failed", failureCode: "OCCURRENCE_FORM_OUTDATED" });

    expect(authorizationView({ delivery: delivery(), queue: [newerFailure] })).toMatchObject({
      tone: "attention",
      title: "Ocorrência não enviada",
      secondary: "Pedido anterior (Cliente ausente) aguardando autorização da torre.",
    });

    expect(
      authorizationView({
        delivery: delivery({
          authorization_request: { ...REQUEST, status: "DENIED", note: "Aguarde o cliente" },
        }),
        queue: [newerFailure],
      }),
    ).toMatchObject({
      tone: "attention",
      secondary: "Pedido anterior (Cliente ausente) não autorizado: Aguarde o cliente.",
    });

    expect(
      authorizationView({
        delivery: delivery({ authorization_request: { ...REQUEST, status: "DENIED" } }),
        queue: [queued()],
      }),
    ).toMatchObject({
      tone: "queued",
      secondary: "Pedido anterior (Cliente ausente) não autorizado.",
    });
  });

  it("the second line of an approval says what it did to the delivery", () => {
    const approved = delivery({
      authorization_request: { ...REQUEST, status: "APPROVED", note: "Deixe na portaria." },
    });

    expect(authorizationView({ delivery: approved, queue: [queued()] })?.secondary).toBe(
      "Pedido anterior (Cliente ausente) autorizado: Deixe na portaria.",
    );
    expect(
      authorizationView({
        delivery: approved,
        queue: [queued()],
        occurrenceTypes: [{ id: "type-ausente", blocks_delivery: true }],
      })?.secondary,
    ).toBe("Pedido anterior (Cliente ausente) autorizado: entrega registrada como Insucesso.");
  });

  it("no second line when there is no request to keep in view", () => {
    expect(
      authorizationView({ delivery: delivery({ authorization_request: null }), queue: [queued()] }),
    ).not.toHaveProperty("secondary");
    expect(
      authorizationView({
        delivery: delivery({ authorization_request: { ...REQUEST, status: "SUPERSEDED" } }),
        queue: [queued()],
      }),
    ).not.toHaveProperty("secondary");
  });

  // Before: "Vai para a torre quando houver conexão." — false for an item
  // parked because the company switched the module off.
  it("a report parked by the module says what it waits for", () => {
    expect(
      authorizationView({
        delivery: delivery({ authorization_request: null }),
        queue: [queued({ status: "parked" })],
        occurrenceTypes: [{ id: "type-ausente", requires_authorization: true }],
      }),
    ).toEqual({
      tone: "queued",
      title: "Pedido de autorização salvo no aparelho",
      message: null,
      nextStep: "Aguardando a empresa reativar o módulo Entregas.",
    });

    expect(
      authorizationView({
        delivery: delivery({ authorization_request: null }),
        queue: [queued({ status: "parked" })],
      }),
    ).toMatchObject({
      title: "Ocorrência salva no aparelho",
      nextStep: "Aguardando a empresa reativar o módulo Entregas.",
    });
  });

  // Before: "Pode seguir com a entrega." after an approval that FAILED the
  // delivery (a blocking type) — the opposite of what happened.
  it("an approval of a blocking type says the delivery ended", () => {
    expect(
      authorizationView({
        delivery: delivery({ authorization_request: { ...REQUEST, status: "APPROVED" } }),
        occurrenceTypes: [{ id: "type-ausente", requires_authorization: true, blocks_delivery: true }],
      }),
    ).toMatchObject({
      tone: "approved",
      title: "Ocorrência autorizada",
      nextStep: "Entrega registrada como Insucesso. Siga para a próxima parada.",
    });

    expect(
      authorizationView({
        delivery: delivery({ authorization_request: { ...REQUEST, status: "APPROVED" } }),
        occurrenceTypes: [{ id: "type-ausente", requires_authorization: true, blocks_delivery: false }],
      }),
    ).toMatchObject({ nextStep: "Pode seguir com a entrega." });
  });

  it("another delivery's queued report is not this stop's", () => {
    expect(
      queuedOccurrenceFor(
        [queued({ endpoint: "/delivery/report-occurrence/delivery-10/business/business-1" })],
        "delivery-1",
      ),
    ).toBeNull();
  });

  it("the newest queued report is the one that counts", () => {
    const older = queued({ createdAt: "2026-09-29T15:00:00.000Z", status: "failed" });
    const newer = queued({ createdAt: "2026-09-29T15:30:00.000Z" });

    expect(queuedOccurrenceFor([newer, older], "delivery-1")).toBe(newer);
  });
});
