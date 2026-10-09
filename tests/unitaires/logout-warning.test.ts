import { describe, expect, it, vi } from "vitest";

import {
  countOpenDrafts,
  logoutWarning,
} from "@/features/submissions/logout-rules";

const storedKeys = new Set<string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getAllKeys: async () => [...storedKeys] },
}));

vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {},
  Paths: { document: "doc" },
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));

vi.mock("@/features/submissions/outbox", () => ({ detachOutbox: () => {} }));

/**
 * What signing out leaves behind, said before it happens (MOB-15).
 *
 * The queue survives a logout but only the same account ever sends it; the
 * half-filled forms are deleted. The modal used to ask only "tem certeza?",
 * so on a phone shared between shifts a proof of delivery could sit on the
 * device for good with nobody told.
 */
const none = { pending: 0, failed: 0, parked: 0, unclaimed: 0, drafts: 0 };
const online = { isOffline: false };

describe("signing out with nothing left behind", () => {
  it("is the plain confirmation it always was", () => {
    expect(logoutWarning(none, online)).toEqual({
      hasRisk: false,
      title: "Sair da conta?",
      lines: [],
      confirmLabel: "Confirmar saída",
      canSendNow: false,
      canReviewQueue: false,
    });
  });
});

describe("signing out with submissions still on the phone", () => {
  it("says they stay here and only this account sends them", () => {
    const warning = logoutWarning({ ...none, pending: 2 }, online);

    expect(warning.hasRisk).toBe(true);
    expect(warning.title).toBe("Sair com pendências?");
    expect(warning.confirmLabel).toBe("Sair mesmo assim");
    expect(warning.lines).toEqual([
      "2 envios ainda não chegaram à empresa. Eles ficam guardados neste aparelho e só serão enviados quando você entrar de novo com esta conta.",
    ]);

    // What can still be done about it, right now.
    expect(warning.canSendNow).toBe(true);
    expect(warning.canReviewQueue).toBe(true);
  });

  it("speaks of one in the singular", () => {
    expect(logoutWarning({ ...none, pending: 1 }, online).lines).toEqual([
      "1 envio ainda não chegou à empresa. Ele fica guardado neste aparelho e só será enviado quando você entrar de novo com esta conta.",
    ]);
  });

  it("counts refused and parked ones too, and says what each needs", () => {
    const warning = logoutWarning({ ...none, failed: 1, parked: 2 }, online);

    expect(warning.lines).toEqual([
      "3 envios ainda não chegaram à empresa. Eles ficam guardados neste aparelho e só serão enviados quando você entrar de novo com esta conta.",
      "1 envio foi recusado e precisa da sua decisão.",
      "2 envios aguardam a empresa reativar um módulo.",
    ]);

    // Nothing here would leave by pressing "Enviar agora".
    expect(warning.canSendNow).toBe(false);
    expect(warning.canReviewQueue).toBe(true);
  });

  it("does not offer to send what cannot go without a connection", () => {
    const warning = logoutWarning({ ...none, pending: 1 }, { isOffline: true });

    expect(warning.canSendNow).toBe(false);
    expect(warning.lines).toContain(
      "Sem conexão agora: não é possível enviar antes de sair.",
    );
  });
});

describe("signing out with submissions left by an earlier login", () => {
  it("says they never leave on their own, and where to claim them", () => {
    // Shown on the pending screen and sent by nobody until someone says they
    // are theirs: the same silent loss the warning exists for.
    const warning = logoutWarning({ ...none, unclaimed: 1 }, online);

    expect(warning).toMatchObject({
      hasRisk: true,
      canSendNow: false,
      canReviewQueue: true,
    });
    expect(warning.lines).toEqual([
      "1 envio de um acesso anterior não sai sozinho: confirme na tela de envios pendentes se ele é seu.",
    ]);

    expect(logoutWarning({ ...none, unclaimed: 2 }, online).lines).toEqual([
      "2 envios de um acesso anterior não saem sozinhos: confirme na tela de envios pendentes se eles são seus.",
    ]);
  });
});

describe("after Enviar agora", () => {
  it("says so when some pending submissions are still here", () => {
    const warning = logoutWarning(
      { ...none, pending: 1 },
      { isOffline: false, sendIncomplete: true },
    );

    expect(warning.lines).toContain(
      "Nem tudo foi enviado agora. Verifique a conexão e tente de novo; o que ficou continua guardado neste aparelho.",
    );
    // Still offered: the next try may go through.
    expect(warning.canSendNow).toBe(true);
  });

  it("says nothing more once everything went", () => {
    expect(
      logoutWarning(none, { isOffline: false, sendIncomplete: true }).lines,
    ).toEqual([]);
  });
});

describe("signing out from the access-denied screen", () => {
  // Revoked, inactive driver or no profile: that screen's "Sair da conta"
  // signed out with no warning at all. It gets the same warning, without the
  // actions that session cannot take.
  const denied = { isOffline: false, canActOnQueue: false };

  it("still says what stays on the phone", () => {
    const warning = logoutWarning(
      { ...none, pending: 1, failed: 1, unclaimed: 1, drafts: 1 },
      denied,
    );

    expect(warning.hasRisk).toBe(true);
    expect(warning.title).toBe("Sair com pendências?");
    expect(warning.confirmLabel).toBe("Sair mesmo assim");
    expect(warning.lines).toHaveLength(4);
  });

  it("does not offer to send or to open a queue behind the same denial", () => {
    const warning = logoutWarning({ ...none, pending: 2, parked: 1 }, denied);

    expect(warning.canSendNow).toBe(false);
    expect(warning.canReviewQueue).toBe(false);

    // Everywhere else both stay on.
    expect(logoutWarning({ ...none, pending: 2, parked: 1 }, online)).toMatchObject({
      canSendNow: true,
      canReviewQueue: true,
    });
  });
});

describe("signing out with a form half filled", () => {
  it("warns that it will be discarded", () => {
    expect(logoutWarning({ ...none, drafts: 1 }, online)).toMatchObject({
      hasRisk: true,
      lines: ["1 formulário em preenchimento será descartado."],
      canReviewQueue: false,
    });

    expect(logoutWarning({ ...none, drafts: 3 }, online).lines).toEqual([
      "3 formulários em preenchimento serão descartados.",
    ]);
  });
});

describe("the drafts counted", () => {
  // The same shape `createSubmissionStorageKey` builds, plus the draft suffix
  // `draft-store` appends.
  const draftKey = (kind: string, userId: string, vehicleId: string) =>
    `@trajetto:submission:${kind}:${userId}:business-1:${vehicleId}:draft`;

  it("are this user's half-filled forms, of any kind", () => {
    const keys = [
      draftKey("fuel", "user-a", "v1"),
      draftKey("checklist", "user-a", "v2"),

      // The submission id kept for the same form is not a second draft.
      "@trajetto:submission:fuel:user-a:business-1:v1",

      // Someone else's, left on a shared phone.
      draftKey("fuel", "user-b", "v1"),

      "@trajetto:outbox:v1",
      "auth-store",
    ];

    expect(countOpenDrafts(keys, "user-a")).toBe(2);
    expect(countOpenDrafts(keys, "user-b")).toBe(1);
  });

  it("are none without a session", () => {
    expect(countOpenDrafts([draftKey("fuel", "user-a", "v1")], null)).toBe(0);
  });

  it("are read from the keys the forms really write", async () => {
    // Pinned to the real key builder: a change of key shape there must not
    // silently turn this warning off.
    const { countOpenSubmissionDrafts, createSubmissionStorageKey } =
      await import("@/features/submissions/submission-id");

    storedKeys.clear();
    storedKeys.add(
      `${createSubmissionStorageKey("fuel", "user-a", "business-1", "v1")}:draft`,
    );
    storedKeys.add(
      `${createSubmissionStorageKey("checklist", "user-b", "business-1", "v1")}:draft`,
    );

    await expect(countOpenSubmissionDrafts("user-a")).resolves.toBe(1);
    await expect(countOpenSubmissionDrafts(null)).resolves.toBe(0);
  });
});
