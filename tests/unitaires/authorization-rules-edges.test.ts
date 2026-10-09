import { describe, expect, it } from "vitest";

import type { DriverAuthorizationRequest } from "@/features/deliveries/types";
import {
  approvalNoteOfPushBody,
  authorizationView,
  decisionNotice,
  decisionPushNotice,
  isOccurrenceDecisionEvent,
  occurrenceDecisionOfPush,
  queuedOccurrenceFor,
  sentReportNotice,
  sentReportOf,
  statusAfterDecision,
  withSentReport,
} from "@/features/occurrences/authorization-rules";

/**
 * Edges of the tower authorization rules left alive by the 06/10 mutation
 * run: payloads with foreign shapes (a socket or push is not trusted), notes
 * made of blanks, several types in the cached day, and ties in the queue.
 */

const EVENT = {
  type: "occurrence.authorization_decided",
  deliveryId: "d1",
  occurrenceId: "o1",
  decision: "APPROVED",
  note: null,
  deliveryStatus: "IN_TRANSIT",
};

const request = (over: Partial<DriverAuthorizationRequest> = {}): DriverAuthorizationRequest => ({
  occurrenceId: "o1",
  occurrenceTypeId: "t1",
  occurrenceTypeName: "Cliente ausente",
  status: "PENDING",
  note: null,
  decidedAt: null,
  requestedAt: "2026-10-06T10:00:00.000Z",
  ...over,
});

const queued = (over: Record<string, unknown> = {}) => ({
  kind: "delivery-occurrence",
  status: "pending",
  endpoint: "/delivery/report-occurrence/d1/sub-1",
  body: { occurrenceTypeId: "t1" } as Record<string, unknown>,
  createdAt: "2026-10-06T10:00:00.000Z",
  ...over,
});

describe("isOccurrenceDecisionEvent", () => {
  it("accepts the contract's event with a null, absent or text note", () => {
    expect(isOccurrenceDecisionEvent(EVENT)).toBe(true);
    expect(isOccurrenceDecisionEvent({ ...EVENT, note: undefined })).toBe(true);
    expect(isOccurrenceDecisionEvent({ ...EVENT, note: "ok" })).toBe(true);
  });

  it("refuses each malformed field on its own", () => {
    expect(isOccurrenceDecisionEvent({ ...EVENT, type: "delivery.updated" })).toBe(false);
    expect(isOccurrenceDecisionEvent({ ...EVENT, deliveryId: 1 })).toBe(false);
    expect(isOccurrenceDecisionEvent({ ...EVENT, occurrenceId: 1 })).toBe(false);
    expect(isOccurrenceDecisionEvent({ ...EVENT, decision: "MAYBE" })).toBe(false);
    expect(isOccurrenceDecisionEvent({ ...EVENT, note: 3 })).toBe(false);
  });

  it("refuses a non-object even when it carries the fields", () => {
    const fn = Object.assign(() => undefined, EVENT);

    expect(isOccurrenceDecisionEvent(fn)).toBe(false);
    expect(isOccurrenceDecisionEvent(null)).toBe(false);
  });
});

describe("occurrenceDecisionOfPush", () => {
  it("refuses data that is not an object even when it carries the fields", () => {
    const data = Object.assign(() => undefined, { occurrenceId: "o1", decision: "APPROVED" });

    expect(occurrenceDecisionOfPush({ data })).toBeNull();
  });

  it("refuses a push without an occurrence id", () => {
    expect(occurrenceDecisionOfPush({ data: { decision: "APPROVED" } })).toBeNull();
  });

  it("keeps only well-typed optional fields", () => {
    expect(
      occurrenceDecisionOfPush({
        title: 5 as unknown as string,
        body: { x: 1 } as unknown as string,
        data: { occurrenceId: "o1", decision: "DENIED", entityId: 7, deliveryStatus: "" },
      }),
    ).toEqual({
      occurrenceId: "o1",
      decision: "DENIED",
      entityId: null,
      deliveryStatus: null,
      title: null,
      body: null,
    });

    expect(
      occurrenceDecisionOfPush({
        title: "Ocorrência autorizada",
        body: "Cliente ausente — Ana: pode seguir.",
        data: { occurrenceId: "o1", decision: "APPROVED", entityId: "d1", deliveryStatus: "FAILED" },
      }),
    ).toEqual({
      occurrenceId: "o1",
      decision: "APPROVED",
      entityId: "d1",
      deliveryStatus: "FAILED",
      title: "Ocorrência autorizada",
      body: "Cliente ausente — Ana: pode seguir.",
    });
  });
});

describe("decisionNotice", () => {
  const ana = { id: "d1", recipient_name: "Ana", status: "IN_TRANSIT" };

  it("treats a blank denial note as no note", () => {
    expect(decisionNotice({ decision: "DENIED", note: "   " }, ana).message).toBe(
      "Ana: a torre negou o pedido. A entrega continua em rota: siga a orientação da torre ou fale com a base.",
    );
  });

  it("does not add a period after a note that already ends a sentence, only at the end", () => {
    expect(decisionNotice({ decision: "DENIED", note: "Volte amanhã!" }, ana).message).toContain(
      "Ana: Volte amanhã! A entrega",
    );
    expect(decisionNotice({ decision: "DENIED", note: "Rua 3.B" }, ana).message).toContain(
      "Ana: Rua 3.B. A entrega",
    );
  });

  it("keeps a delivery still PENDING or IN_TRANSIT open after an approval", () => {
    for (const deliveryStatus of ["PENDING", "IN_TRANSIT"]) {
      expect(decisionNotice({ decision: "APPROVED", note: null, deliveryStatus }, ana)).toEqual({
        type: "success",
        title: "Ocorrência autorizada",
        message: "Ana: pode seguir com a entrega.",
      });
    }
  });

  it("names each ended status, and an unknown one as encerrada", () => {
    const ended = (deliveryStatus: string) =>
      decisionNotice({ decision: "APPROVED", note: null, deliveryStatus }, ana);

    expect(ended("DELIVERED").message).toBe(
      "Ana: entrega registrada como Entregue. Siga para a próxima parada.",
    );
    expect(ended("CANCELLED").message).toContain("como Cancelada.");
    expect(ended("RETURNED").message).toContain("como encerrada.");
    expect(
      decisionNotice({ decision: "APPROVED", note: "volte amanhã", deliveryStatus: "FAILED" }, ana).message,
    ).toBe("Ana: entrega registrada como Insucesso. Siga para a próxima parada. volte amanhã.");
    expect(ended("FAILED")).toEqual({
      type: "success",
      title: "Ocorrência autorizada",
      message: "Ana: entrega registrada como Insucesso. Siga para a próxima parada.",
    });
  });

  it("appends the tower's note to an open approval", () => {
    expect(
      decisionNotice({ decision: "APPROVED", note: " deixe na portaria ", deliveryStatus: "IN_TRANSIT" }, ana)
        .message,
    ).toBe("Ana: pode seguir com a entrega. deixe na portaria.");
  });
});

describe("approvalNoteOfPushBody", () => {
  it("reads a note glued to the sentence, or after spaces, without blanks around it", () => {
    expect(approvalNoteOfPushBody("Cliente ausente — Ana: pode seguir.Ok tudo")).toBe("Ok tudo");
    expect(approvalNoteOfPushBody("Cliente ausente — Ana:pode seguir. Deixe com o vizinho  ")).toBe(
      "Deixe com o vizinho",
    );
  });
});

describe("decisionPushNotice", () => {
  it("shows a denial push's own words even when the delivery ended", () => {
    const notice = { type: "error" as const, title: "Ocorrência não autorizada", message: "app" };

    expect(
      decisionPushNotice(
        { decision: "DENIED", title: "Negado", body: "Cliente ausente — Ana: negado." },
        notice,
        "FAILED",
      ),
    ).toEqual({ type: "error", title: "Negado", message: "Cliente ausente — Ana: negado." });
  });
});

describe("statusAfterDecision", () => {
  it("only fails the delivery for the decided type being blocking", () => {
    const delivery = {
      id: "d1",
      recipient_name: "Ana",
      status: "IN_TRANSIT",
      authorization_request: request(),
    };
    const answer = { occurrenceId: "o1", decision: "APPROVED" as const, deliveryStatus: null };

    expect(
      statusAfterDecision(answer, delivery, [
        { id: "other", blocks_delivery: true },
        { id: "t1", blocks_delivery: false },
      ]),
    ).toBeNull();
  });
});

describe("withSentReport", () => {
  const report = { occurrenceId: "o9", status: "PENDING" as const };
  const sent = (over = {}) => ({
    deliveryId: "d1",
    occurrenceTypeId: "t1",
    requestedAt: "2026-10-06T10:00:00.000Z",
    report,
    ...over,
  });
  const nameOf = (day: { data: object[] } | undefined) =>
    (day?.data[0] as { authorization_request?: DriverAuthorizationRequest | null } | undefined)
      ?.authorization_request?.occurrenceTypeName;

  it("names the type from the day's catalog, skipping the other types", () => {
    const day = {
      data: [{ id: "d1" }],
      occurrence_types: [
        { id: "t0", name: "Avaria" },
        { id: "t1", name: "Cliente ausente" },
      ],
    };

    expect(nameOf(withSentReport(day, sent()))).toBe("Cliente ausente");
  });

  it("falls back to Ocorrência without a catalog or without the type in it", () => {
    expect(nameOf(withSentReport({ data: [{ id: "d1" }] }, sent()))).toBe("Ocorrência");
    expect(
      nameOf(withSentReport({ data: [{ id: "d1" }], occurrence_types: [{ id: "t0", name: "Avaria" }] }, sent())),
    ).toBe("Ocorrência");
  });
});

describe("sentReportOf", () => {
  it("reads a null answer or null data as a plain report", () => {
    expect(sentReportOf(null)).toEqual({ occurrenceId: null, status: "NOT_REQUIRED" });
    expect(sentReportOf({ data: null })).toEqual({ occurrenceId: null, status: "NOT_REQUIRED" });
  });

  it("passes each authorization status through and maps the rest to NOT_REQUIRED", () => {
    for (const status of ["PENDING", "APPROVED", "DENIED", "SUPERSEDED"]) {
      expect(sentReportOf({ data: { id: "o1", authorization_status: status } }).status).toBe(status);
    }
    expect(sentReportOf({ data: { id: "o1", authorization_status: "" } }).status).toBe("NOT_REQUIRED");
  });

  it("keeps the ticket only with a text id and a numeric number", () => {
    expect(sentReportOf({ data: { id: "o1", ticket: { id: 1, number: 2 } } })).not.toHaveProperty("ticket");
    expect(sentReportOf({ data: { id: "o1", ticket: { id: "t", number: "2" } } })).not.toHaveProperty("ticket");
    expect(sentReportOf({ data: { id: "o1", ticket: { id: "t", number: 2 } } }).ticket).toEqual({
      id: "t",
      number: 2,
    });
  });
});

describe("sentReportNotice", () => {
  it("titles the PENDING and SUPERSEDED answers as registered", () => {
    expect(sentReportNotice("PENDING").title).toBe("Ocorrência registrada");
    expect(sentReportNotice("SUPERSEDED").title).toBe("Ocorrência registrada");
  });
});

describe("queuedOccurrenceFor", () => {
  it("ignores other kinds on the same delivery", () => {
    expect(queuedOccurrenceFor([queued({ kind: "delivery-delivered" })], "d1")).toBeNull();
  });

  it("returns the newest, and the later-queued one on a tie", () => {
    const older = queued({ endpoint: "/delivery/report-occurrence/d1/a", createdAt: "2026-10-06T09:00:00.000Z" });
    const newer = queued({ endpoint: "/delivery/report-occurrence/d1/b", createdAt: "2026-10-06T10:00:00.000Z" });
    const tie = queued({ endpoint: "/delivery/report-occurrence/d1/c", createdAt: "2026-10-06T10:00:00.000Z" });

    expect(queuedOccurrenceFor([older, newer], "d1")).toBe(newer);
    expect(queuedOccurrenceFor([older, newer, tie], "d1")).toBe(tie);
  });
});

describe("authorizationView", () => {
  it("explains a refused report without a reviewable reason", () => {
    expect(
      authorizationView({ delivery: { id: "d1" }, queue: [queued({ status: "failed", failureCode: "X" })] }),
    ).toEqual({
      tone: "attention",
      title: "Ocorrência não enviada",
      message: "A empresa recusou o envio desta ocorrência.",
      nextStep: "Abra Envios pendentes para ver o motivo e decidir.",
    });
  });

  it("uses the review's own words for a reviewable refusal", () => {
    const view = authorizationView({
      delivery: { id: "d1" },
      queue: [queued({ status: "failed", failureCode: "OCCURRENCE_TYPE_INACTIVE" })],
    });

    expect(view?.message).toBe(
      "Este tipo de ocorrência foi desativado pela empresa. Escolha outro tipo para enviar o registro.",
    );
    expect(view?.nextStep).toBe("Abra Envios pendentes e toque em Escolher outro tipo.");
  });

  it("only treats the queued report as a tower request for its own type", () => {
    const view = (types: { id: string; requires_authorization?: boolean }[]) =>
      authorizationView({ delivery: { id: "d1" }, queue: [queued()], occurrenceTypes: types });

    expect(view([{ id: "other", requires_authorization: true }])).toEqual({
      tone: "queued",
      title: "Ocorrência salva no aparelho",
      message: null,
      nextStep: "Será enviada quando houver conexão.",
    });
    expect(view([{ id: "t1", requires_authorization: false }])?.title).toBe("Ocorrência salva no aparelho");
    expect(view([{ id: "t1", requires_authorization: true }])?.title).toBe(
      "Pedido de autorização salvo no aparelho",
    );
  });

  it("drops an unreadable request time from the waiting line", () => {
    let called = false;
    const view = authorizationView({
      delivery: { id: "d1", authorization_request: request({ requestedAt: "garbage" }) },
      formatTime: () => {
        called = true;
        return "??";
      },
    });

    expect(view?.message).toBe("Cliente ausente");
    expect(called).toBe(false);
  });

  it("shows the request time on the phone's clock by default", () => {
    const view = authorizationView({ delivery: { id: "d1", authorization_request: request() } });

    expect(view?.message).toMatch(/^Cliente ausente · pedido às \d{2}:\d{2}$/);
  });

  it("lets an approval go on unless its own type blocks, and shows the note", () => {
    const view = authorizationView({
      delivery: { id: "d1", authorization_request: request({ status: "APPROVED", note: "Deixe na portaria" }) },
      occurrenceTypes: [{ id: "other", blocks_delivery: true }],
    });

    expect(view?.message).toBe("Cliente ausente: Deixe na portaria");
    expect(view?.nextStep).toBe("Pode seguir com a entrega.");
  });

  it("words the older request under a newer report", () => {
    const later = queued({ createdAt: "2026-10-06T11:00:00.000Z" });
    const secondary = (over: Partial<DriverAuthorizationRequest>, types: { id: string; blocks_delivery?: boolean }[] = []) =>
      authorizationView({
        delivery: { id: "d1", authorization_request: request(over) },
        queue: [later],
        occurrenceTypes: types,
      })?.secondary;

    expect(secondary({ status: "DENIED", note: "   " })).toBe(
      "Pedido anterior (Cliente ausente) não autorizado.",
    );
    expect(secondary({ status: "DENIED", note: " fale com a base " })).toBe(
      "Pedido anterior (Cliente ausente) não autorizado: fale com a base.",
    );
    expect(secondary({ status: "APPROVED" }, [{ id: "other", blocks_delivery: true }])).toBe(
      "Pedido anterior (Cliente ausente) autorizado.",
    );
    expect(secondary({ status: "APPROVED" }, [{ id: "t1", blocks_delivery: false }])).toBe(
      "Pedido anterior (Cliente ausente) autorizado.",
    );
    expect(secondary({ status: "APPROVED" }, [{ id: "t1", blocks_delivery: true }])).toBe(
      "Pedido anterior (Cliente ausente) autorizado: entrega registrada como Insucesso.",
    );
  });
});
