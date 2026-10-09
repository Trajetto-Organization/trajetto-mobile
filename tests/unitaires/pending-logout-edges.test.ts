import { describe, expect, it } from "vitest";

import { describePendingItem } from "@/features/submissions/pending-item-rules";
import { countOpenDrafts, logoutWarning } from "@/features/submissions/logout-rules";

/**
 * Wording and branches of the pending screen and of the logout warning that
 * the mutation run (Stryker, 06/10/2026) found unpinned: each view is checked
 * whole, so a flipped flag or a blanked sentence fails here.
 */
const NOW = Date.parse("2026-09-28T12:00:00Z");

const item = (overrides: Partial<Parameters<typeof describePendingItem>[0]>) => ({
  kind: "fuel",
  createdAt: new Date(NOW - 60_000).toISOString(),
  status: "pending" as const,
  attempts: 0,
  ...overrides,
});

describe("pending screen: every branch says what it is", () => {
  it("asks the driver to claim an item from an earlier access", () => {
    expect(describePendingItem(item({}), "unclaimed", NOW)).toEqual({
      tone: "danger",
      message:
        "Este envio ficou salvo de um acesso anterior. Confirme que é seu para enviá-lo com o seu login.",
      canDiscard: true,
      retryLabel: "É meu, enviar",
      isExpired: false,
    });
  });

  it("reads an item still waiting as waiting, even if an old failure code is on it", () => {
    expect(
      describePendingItem(
        item({ kind: "delivery-proof", attempts: 1, failureCode: "DELIVERY_NOT_FOUND" }),
        "own",
        NOW,
      ),
    ).toEqual({
      tone: "neutral",
      message: "Aguardando nova tentativa (1 tentativa).",
      canDiscard: false,
      retryLabel: null,
      isExpired: false,
    });
  });

  it("counts several attempts in the plural", () => {
    expect(describePendingItem(item({ attempts: 2 }), "own", NOW).message).toBe(
      "Aguardando nova tentativa (2 tentativas).",
    );
  });

  it("does not say the route was taken for a start refused for another reason", () => {
    expect(
      describePendingItem(
        item({ kind: "delivery-start-route", status: "failed", failureCode: "OTHER" }),
        "own",
        NOW,
      ),
    ).toEqual({
      tone: "danger",
      message: "O servidor recusou este envio.",
      canDiscard: true,
      retryLabel: "Tentar de novo",
      isExpired: false,
    });
  });

  it("names no module for a parked kind this build does not know", () => {
    expect(describePendingItem(item({ kind: "mystery", status: "parked" }), "own", NOW).message).toBe(
      "Aguardando a empresa reativar um módulo. O envio sai sozinho quando o módulo voltar.",
    );
  });
});

describe("logout warning: counts and wording", () => {
  const none = { pending: 0, failed: 0, parked: 0, unclaimed: 0, drafts: 0 };

  it("says how many were refused, in the plural", () => {
    expect(logoutWarning({ ...none, failed: 2 }, { isOffline: false }).lines).toContain(
      "2 envios foram recusados e precisam da sua decisão.",
    );
  });

  it("says one parked item in the singular and several in the plural", () => {
    expect(logoutWarning({ ...none, parked: 1 }, { isOffline: false }).lines).toContain(
      "1 envio aguarda a empresa reativar um módulo.",
    );
    expect(logoutWarning({ ...none, parked: 2 }, { isOffline: false }).lines).toContain(
      "2 envios aguardam a empresa reativar um módulo.",
    );
  });

  it("does not warn about the missing connection when nothing is waiting to be sent", () => {
    expect(logoutWarning({ ...none, failed: 1 }, { isOffline: true }).lines).not.toContain(
      "Sem conexão agora: não é possível enviar antes de sair.",
    );
  });

  it("counts only this user's drafts under the form key prefix", () => {
    const keys = [
      "@trajetto:submission:fuel:u-1:abc:draft",
      "other:submission:fuel:u-1:draft",
      "@trajetto:submission:fuel::abc:draft",
    ];

    expect(countOpenDrafts(keys, "u-1")).toBe(1);
    expect(countOpenDrafts(keys, "")).toBe(0);
  });
});
