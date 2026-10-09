import { describe, expect, it } from "vitest";

import { describePendingItem } from "@/features/submissions/pending-item-rules";
import { START_ROUTE_EXPIRED_MESSAGE } from "@/features/submissions/outbox-rules";

/**
 * What the pending screen promises for each queued submission: why it is
 * still on the phone, and what the driver can do about it.
 *
 * A parked item — refused because the company switched a module off — read
 * "Aguardando conexão." and offered nothing, so the driver could neither
 * understand nor act on it (MOB-03).
 */
const NOW = Date.parse("2026-09-28T12:00:00Z");

const item = (overrides: Partial<Parameters<typeof describePendingItem>[0]>) => ({
  kind: "fuel",
  createdAt: new Date(NOW - 60_000).toISOString(),
  status: "pending" as const,
  attempts: 0,
  ...overrides,
});

describe("a submission parked because a module is off", () => {
  it("names the module it waits for and offers to try now or discard", () => {
    expect(describePendingItem(item({ status: "parked" }), "own", NOW)).toEqual({
      tone: "warning",
      message:
        "Aguardando a empresa reativar o módulo Gestão de Frota. O envio sai sozinho quando o módulo voltar.",
      canDiscard: true,
      retryLabel: "Tentar agora",
      isExpired: false,
    });
  });

  it("names Entregas for a delivery step", () => {
    expect(
      describePendingItem(
        item({ kind: "delivery-proof", status: "parked" }),
        "own",
        NOW,
      ).message,
    ).toBe(
      "Aguardando a empresa reativar o módulo Entregas. O envio sai sozinho quando o módulo voltar.",
    );
  });

  it("is never described as waiting for a connection", () => {
    expect(
      describePendingItem(item({ status: "parked", attempts: 0 }), "own", NOW)
        .message,
    ).not.toContain("conexão");
  });
});

describe("the other states keep what they said", () => {
  it("a pending one waits, with nothing to press", () => {
    expect(describePendingItem(item({}), "own", NOW)).toMatchObject({
      tone: "neutral",
      message: "Aguardando conexão.",
      canDiscard: false,
      retryLabel: null,
    });

    expect(describePendingItem(item({ attempts: 2 }), "own", NOW).message).toBe(
      "Aguardando nova tentativa (2 tentativas).",
    );
  });

  it("a refused one shows the server's reason and both choices", () => {
    expect(
      describePendingItem(
        item({ status: "failed", lastError: "Quilometragem menor que a atual." }),
        "own",
        NOW,
      ),
    ).toMatchObject({
      tone: "danger",
      message: "Quilometragem menor que a atual.",
      canDiscard: true,
      retryLabel: "Tentar de novo",
    });
  });

  it("a contract refusal says an update sends it", () => {
    expect(
      describePendingItem(
        item({ status: "failed", failure: "contract", lastError: "Rota removida." }),
        "own",
        NOW,
      ).message,
    ).toBe(
      "Rota removida. Atualize o aplicativo: este envio sai sozinho depois da atualização.",
    );
  });

  it("an unclaimed one asks whose it is", () => {
    expect(describePendingItem(item({}), "unclaimed", NOW)).toMatchObject({
      tone: "danger",
      retryLabel: "É meu, enviar",
      canDiscard: true,
    });
  });

  it("an expired departure only offers discarding", () => {
    const expired = item({
      kind: "delivery-start-route",
      createdAt: new Date(NOW - 13 * 60 * 60 * 1000).toISOString(),
    });

    expect(describePendingItem(expired, "own", NOW)).toEqual({
      tone: "danger",
      message: START_ROUTE_EXPIRED_MESSAGE,
      canDiscard: true,
      retryLabel: null,
      isExpired: true,
    });
  });
});

describe("a delivery step refused because the delivery left the driver's route (route design §6.4)", () => {
  const LEFT_ROUTE =
    "Esta entrega foi retirada da sua rota. Fale com a central antes de descartar este envio.";

  it.each([
    ["delivery-arrival", "DELIVERY_NOT_FOUND"],
    ["delivery-proof", "DELIVERY_NOT_FOUND"],
    ["delivery-delivered", "DELIVERY_NOT_FOUND"],
    ["delivery-occurrence", "DELIVERY_NOT_FOUND"],
    ["delivery-on-the-way", "ROUTE_STOP_NOT_FOUND"],
  ])("%s refused with %s says so instead of the API's generic 404", (kind, failureCode) => {
    expect(
      describePendingItem(
        item({
          kind,
          status: "failed",
          attempts: 1,
          failure: "permanent",
          failureCode,
          lastError: "Entrega não encontrada! Por favor, tente novamente.",
        }),
        "own",
        NOW,
      ),
    ).toEqual({
      tone: "danger",
      message: LEFT_ROUTE,
      canDiscard: true,
      retryLabel: "Tentar de novo",
      isExpired: false,
    });
  });

  it("keeps the API's words for any other refusal", () => {
    expect(
      describePendingItem(
        item({
          kind: "fuel",
          status: "failed",
          attempts: 1,
          failure: "permanent",
          failureCode: "DELIVERY_NOT_FOUND",
          lastError: "Outra coisa.",
        }),
        "own",
        NOW,
      ).message,
    ).toBe("Outra coisa.");
  });
});

describe("an 'Iniciar rota' refused because the route is no longer the driver's", () => {
  // The route use cases answered 404 with code BAD_REQUEST; they now say
  // DELIVERY_ROUTE_NOT_FOUND for a deleted route, another company's and one
  // handed to another driver alike.
  it("says the route was taken, and keeps the retry for when it comes back", () => {
    expect(
      describePendingItem(
        item({
          kind: "delivery-start-route",
          status: "failed",
          attempts: 1,
          failure: "permanent",
          failureCode: "DELIVERY_ROUTE_NOT_FOUND",
          lastError: "Rota não encontrada.",
        }),
        "own",
        NOW,
      ),
    ).toEqual({
      tone: "danger",
      message:
        "Esta rota foi retirada de você. Fale com a central antes de descartar este envio.",
      canDiscard: true,
      retryLabel: "Tentar de novo",
      isExpired: false,
    });
  });

  it("keeps the API's words when another kind meets the same code", () => {
    expect(
      describePendingItem(
        item({
          kind: "delivery-on-the-way",
          status: "failed",
          attempts: 1,
          failure: "permanent",
          failureCode: "DELIVERY_ROUTE_NOT_FOUND",
          lastError: "Rota não encontrada.",
        }),
        "own",
        NOW,
      ).message,
    ).toBe("Rota não encontrada.");
  });
});
