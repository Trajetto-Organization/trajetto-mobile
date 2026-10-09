import { describe, expect, it } from "vitest";

import {
  EMPTY_PROOF_FEEDBACK_STATE,
  MAX_PROOF_FEEDBACK_ENTRIES,
  PHONE_CLOCK_MARGIN_MS,
  PROOF_FEEDBACK_TTL_MS,
  markDeliveryProven,
  notificationDeliveryTarget,
  proofFeedbackFromNotification,
  proofFeedbackFromPush,
  proofFeedbackGuidance,
  proofFeedbackProblems,
  proofFeedbackStep,
  pruneProofFeedback,
  recordProofFeedback,
  visibleProofFeedback,
  type ProofFeedback,
  type ProofFeedbackState,
} from "@/features/notifications/proof-feedback-rules";

/**
 * The automatic reading of a proof photo, back to the driver
 * (decision 6.9; docs/contratos-app/ai-feedback.md).
 *
 * The API warns once, by push and by an inbox row; the app keeps the latest
 * warning per delivery so the delivery can show it after the push is gone,
 * and tells the driver what to do — without ever saying the delivery was
 * refused, and without asking for a photo the app cannot take (a proven
 * delivery is final in the app).
 */

const DELIVERY = "0192b1c4-0000-4000-8000-000000000001";
const OTHER = "0192b1c4-0000-4000-8000-000000000002";

// The contract's own example, as the API renders it.
const MESSAGE =
  "Entrega para Mercado Central. A leitura automática apontou: não foi encontrada assinatura; o número da NF-e lido não é o desta entrega. Se ainda estiver no local, confira o canhoto com o destinatário. A equipe vai revisar o comprovante.";

const BAD_PHOTO =
  "Entrega para Mercado Central. A leitura automática apontou: a foto está ruim demais para leitura. Se ainda estiver no local, confira o canhoto com o destinatário. A equipe vai revisar o comprovante.";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "notification-1",
  type: "delivery-proof-ai",
  title: "Comprovante com possível problema",
  message: MESSAGE,
  entityId: DELIVERY,
  created_at: "2026-09-29T12:00:00.000Z",
  ...overrides,
});

const warning = (overrides: Partial<ProofFeedback> = {}): ProofFeedback => ({
  deliveryId: DELIVERY,
  title: "Comprovante com possível problema",
  message: MESSAGE,
  at: "2026-09-29T12:00:00.000Z",
  notificationId: "notification-1",
  live: false,
  ...overrides,
});

const T0 = Date.parse("2026-09-29T12:00:05.000Z");

describe("reading a warning from each channel", () => {
  it("takes the inbox row and its socket twin, by type", () => {
    expect(proofFeedbackFromNotification(row())).toEqual(warning());

    // The socket hears the row as it is created.
    expect(proofFeedbackFromNotification(row(), { live: true })).toEqual(
      warning({ live: true }),
    );

    expect(proofFeedbackFromNotification(row({ type: "service-order" }))).toBeNull();
    expect(proofFeedbackFromNotification(row({ entityId: null }))).toBeNull();
    expect(proofFeedbackFromNotification(row({ entityId: "../vehicles" }))).toBeNull();
    expect(proofFeedbackFromNotification(row({ message: "  " }))).toBeNull();
    expect(proofFeedbackFromNotification(row({ created_at: "ontem" }))).toBeNull();
  });

  it("takes the push by data.entityId, never by the pipeline's data.deliveryId", () => {
    const at = new Date("2026-09-29T12:00:03.000Z");

    const content = {
      title: "Comprovante com possível problema",
      body: MESSAGE,
      data: {
        url: "/deliveries",
        type: "delivery-proof.ai-flagged",
        entityId: DELIVERY,
        // The id of the notification's delivery attempt, stamped on every push.
        deliveryId: "0192b1c4-0000-4000-8000-0000000000ff",
      },
    };

    expect(proofFeedbackFromPush(content, at)).toEqual({
      deliveryId: DELIVERY,
      title: "Comprovante com possível problema",
      message: MESSAGE,
      at: at.toISOString(),
      notificationId: null,
      live: false,
    });

    expect(
      proofFeedbackFromPush({ ...content, data: { ...content.data, type: "chat-message.sent" } }, at),
    ).toBeNull();
    expect(
      proofFeedbackFromPush({ ...content, data: { url: "/deliveries", type: "delivery-proof.ai-flagged", deliveryId: DELIVERY } }, at),
    ).toBeNull();
    expect(proofFeedbackFromPush({ ...content, data: undefined }, at)).toBeNull();
    expect(proofFeedbackFromPush(content, new Date(Number.NaN))).toBeNull();
  });

  it("lists the problems the reading pointed at, or none for another sentence", () => {
    expect(proofFeedbackProblems(MESSAGE)).toEqual([
      "não foi encontrada assinatura",
      "o número da NF-e lido não é o desta entrega",
    ]);

    expect(proofFeedbackProblems(BAD_PHOTO)).toEqual([
      "a foto está ruim demais para leitura",
    ]);

    // The card then shows the message whole.
    expect(
      proofFeedbackProblems(
        "Entrega para X. A foto está ruim demais para qualquer leitura automática. A equipe vai revisar o comprovante.",
      ),
    ).toEqual([]);
  });
});

describe("the warning kept for a delivery", () => {
  it("keeps one copy when the socket, the push and the inbox all bring it", () => {
    // Socket first, with the row's id.
    let state = recordProofFeedback(
      EMPTY_PROOF_FEEDBACK_STATE,
      warning({ live: true }),
      T0,
    );

    // The push of the same warning (no id, sent by FCM a moment later).
    state = recordProofFeedback(
      state,
      warning({ notificationId: null, at: "2026-09-29T12:00:04.000Z" }),
      T0 + 1_000,
    );

    // The inbox row, read later.
    state = recordProofFeedback(state, warning(), T0 + 60_000);

    expect(Object.keys(state.byDelivery)).toEqual([DELIVERY]);
    expect(state.byDelivery[DELIVERY]).toEqual({
      ...warning({ live: true }),
      receivedAt: T0,
    });
  });

  it("names the row once the inbox brings it after a tapped push", () => {
    let state = recordProofFeedback(
      EMPTY_PROOF_FEEDBACK_STATE,
      warning({ notificationId: null, at: "2026-09-29T12:00:04.000Z" }),
      T0,
    );

    state = recordProofFeedback(state, warning(), T0 + 30_000);

    expect(state.byDelivery[DELIVERY]).toMatchObject({
      notificationId: "notification-1",
      at: "2026-09-29T12:00:00.000Z",
      // The first time the phone heard of it, for the list check.
      receivedAt: T0,
    });
  });

  it("replaces an older warning with a newer one, and never the reverse", () => {
    const later = warning({
      notificationId: "notification-2",
      at: "2026-09-29T15:00:00.000Z",
      message: BAD_PHOTO,
    });

    let state = recordProofFeedback(EMPTY_PROOF_FEEDBACK_STATE, warning(), T0);
    state = recordProofFeedback(state, later, T0 + 1);

    expect(visibleProofFeedback(state, DELIVERY)?.message).toBe(BAD_PHOTO);

    // The older row read from the inbox afterwards changes nothing.
    const again = recordProofFeedback(state, warning(), T0 + 2);

    expect(again).toBe(state);
  });

  it("stops showing a warning once a new proof of the delivery left the phone", () => {
    let state = recordProofFeedback(EMPTY_PROOF_FEEDBACK_STATE, warning(), T0);

    state = markDeliveryProven(state, DELIVERY, T0 + 3_600_000, T0 + 3_600_000);

    expect(visibleProofFeedback(state, DELIVERY)).toBeNull();

    // The same old row read again from the inbox does not come back.
    state = recordProofFeedback(state, warning(), T0 + 3_700_000);
    expect(visibleProofFeedback(state, DELIVERY)).toBeNull();

    // A warning about the new photo does.
    state = recordProofFeedback(
      state,
      warning({ notificationId: "notification-3", at: "2026-09-29T13:30:00.000Z" }),
      T0 + 5_500_000,
    );

    expect(visibleProofFeedback(state, DELIVERY)?.notificationId).toBe("notification-3");
  });

  it("keeps each delivery apart", () => {
    let state = recordProofFeedback(EMPTY_PROOF_FEEDBACK_STATE, warning(), T0);
    state = markDeliveryProven(state, OTHER, T0 + 3_600_000, T0 + 3_600_000);

    expect(visibleProofFeedback(state, DELIVERY)).not.toBeNull();
    expect(visibleProofFeedback(state, OTHER)).toBeNull();
  });

  it("forgets past the offline horizon and past its bound", () => {
    const state = recordProofFeedback(EMPTY_PROOF_FEEDBACK_STATE, warning(), T0);

    expect(
      pruneProofFeedback(state, T0 + PROOF_FEEDBACK_TTL_MS + 1).byDelivery,
    ).toEqual({});

    const crowded: ProofFeedbackState = {
      byDelivery: Object.fromEntries(
        Array.from({ length: MAX_PROOF_FEEDBACK_ENTRIES + 5 }, (_, index) => {
          const id = `0192b1c4-0000-4000-8000-${String(index).padStart(12, "0")}`;

          return [id, { ...warning({ deliveryId: id }), receivedAt: T0 + index }];
        }),
      ),
      newProofs: {},
    };

    const pruned = pruneProofFeedback(crowded, T0 + 10_000);

    expect(Object.keys(pruned.byDelivery)).toHaveLength(MAX_PROOF_FEEDBACK_ENTRIES);

    // The newest are the ones kept.
    expect(Object.values(pruned.byDelivery).some((entry) => entry.receivedAt === T0)).toBe(false);
  });
});

describe("a new proof against the warnings about its delivery", () => {
  // Server clock: the proof committed at 12:00:00 and its reading warned at
  // 12:00:05. The phone dates only the tap and when it heard each warning.
  const aboutThisProof = (overrides: Partial<ProofFeedback> = {}) =>
    warning({ notificationId: "notification-7", at: "2026-09-29T12:00:05.000Z", ...overrides });

  it("keeps the warning about the proof just sent when the phone's clock runs ahead", () => {
    // The phone reads 12:00:10 when the server reads 12:00:00.
    const tap = Date.parse("2026-09-29T12:00:10.000Z");

    const marked = markDeliveryProven(EMPTY_PROOF_FEEDBACK_STATE, DELIVERY, tap, tap + 2_000);

    // Over the socket, and read from the inbox: both show.
    const live = recordProofFeedback(marked, aboutThisProof({ live: true }), tap + 6_000);
    const read = recordProofFeedback(marked, aboutThisProof(), tap + 6_000);

    expect(visibleProofFeedback(live, DELIVERY)?.notificationId).toBe("notification-7");
    expect(visibleProofFeedback(read, DELIVERY)?.notificationId).toBe("notification-7");
  });

  it("keeps it when the proof's mark reaches the store after the warning", () => {
    // Tapped at 12:00:00, warning heard at 12:00:06, the mark stored after.
    const tap = Date.parse("2026-09-29T12:00:00.000Z");

    let state = recordProofFeedback(EMPTY_PROOF_FEEDBACK_STATE, aboutThisProof(), tap + 6_000);
    state = markDeliveryProven(state, DELIVERY, tap, tap + 20_000);

    expect(visibleProofFeedback(state, DELIVERY)?.notificationId).toBe("notification-7");

    // Its inbox copy, read later, changes nothing.
    state = recordProofFeedback(state, aboutThisProof(), tap + 60_000);

    expect(visibleProofFeedback(state, DELIVERY)?.notificationId).toBe("notification-7");
  });

  it("hides the replaced warning even when the new proof follows it within minutes", () => {
    // Warned at 12:00:00; the office reopened it; proven again at 12:03.
    let state = recordProofFeedback(EMPTY_PROOF_FEEDBACK_STATE, warning(), T0);
    state = markDeliveryProven(state, DELIVERY, T0 + 180_000, T0 + 185_000);

    expect(visibleProofFeedback(state, DELIVERY)).toBeNull();

    // Its inbox row and a late tap on its push (sent at 12:00:04) stay hidden.
    state = recordProofFeedback(state, warning(), T0 + 200_000);
    state = recordProofFeedback(
      state,
      warning({ notificationId: null, at: "2026-09-29T12:00:04.000Z" }),
      T0 + 210_000,
    );

    expect(visibleProofFeedback(state, DELIVERY)).toBeNull();
  });

  it("shows a warning about the new photo, even in the old one's words", () => {
    // The old warning came by push only: no row id.
    let state = recordProofFeedback(
      EMPTY_PROOF_FEEDBACK_STATE,
      warning({ notificationId: null, at: "2026-09-29T12:00:04.000Z" }),
      T0,
    );
    state = markDeliveryProven(state, DELIVERY, T0 + 180_000, T0 + 185_000);

    expect(visibleProofFeedback(state, DELIVERY)).toBeNull();

    // The new photo has no signature either: same words, a new row at 12:04,
    // kept as heard now (not merged into the replaced one).
    state = recordProofFeedback(
      state,
      warning({ notificationId: "notification-8", at: "2026-09-29T12:04:00.000Z" }),
      T0 + 240_000,
    );

    expect(visibleProofFeedback(state, DELIVERY)).toMatchObject({
      notificationId: "notification-8",
      at: "2026-09-29T12:04:00.000Z",
      receivedAt: T0 + 240_000,
    });
  });

  it("hides a warning nobody heard before the new proof only when it is well before the tap", () => {
    // The push was missed and the inbox unread: nothing held at the tap.
    const tap = Date.parse("2026-09-29T13:00:00.000Z");

    let state = markDeliveryProven(EMPTY_PROOF_FEEDBACK_STATE, DELIVERY, tap, tap);

    // The old row (12:00), read from the inbox afterwards.
    state = recordProofFeedback(state, warning(), tap + 60_000);

    expect(visibleProofFeedback(state, DELIVERY)).toBeNull();

    // Inside the clock margin an old row cannot be told from a new one: shown.
    state = recordProofFeedback(
      state,
      warning({
        notificationId: "notification-9",
        at: new Date(tap - PHONE_CLOCK_MARGIN_MS + 1_000).toISOString(),
      }),
      tap + 61_000,
    );

    expect(visibleProofFeedback(state, DELIVERY)?.notificationId).toBe("notification-9");
  });

  it("never hides a warning heard live after the tap, however far ahead the phone's clock is", () => {
    // Nothing held, and the phone reads 12:30 when the server reads 12:00.
    const tap = Date.parse("2026-09-29T12:30:00.000Z");

    let state = markDeliveryProven(EMPTY_PROOF_FEEDBACK_STATE, DELIVERY, tap, tap);
    state = recordProofFeedback(
      state,
      warning({ at: "2026-09-29T12:00:40.000Z", live: true }),
      tap + 41_000,
    );

    expect(visibleProofFeedback(state, DELIVERY)?.notificationId).toBe("notification-1");
  });

  it("ignores an older tap that settles after a newer one", () => {
    const state = recordProofFeedback(EMPTY_PROOF_FEEDBACK_STATE, warning(), T0);
    const newer = markDeliveryProven(state, DELIVERY, T0 + 120_000, T0 + 121_000);

    expect(markDeliveryProven(newer, DELIVERY, T0 + 60_000, T0 + 122_000)).toBe(newer);
  });

  it("forgets a new proof past the offline horizon", () => {
    const state = markDeliveryProven(EMPTY_PROOF_FEEDBACK_STATE, DELIVERY, T0, T0);

    expect(pruneProofFeedback(state, T0 + PROOF_FEEDBACK_TTL_MS + 1).newProofs).toEqual({});
  });

  it("does not bring back a row past the offline horizon once its mark is forgotten", () => {
    // Heard, replaced by a new proof, and both forgotten a week later.
    let state = recordProofFeedback(EMPTY_PROOF_FEEDBACK_STATE, warning(), T0);
    state = markDeliveryProven(state, DELIVERY, T0 + 180_000, T0 + 180_000);
    state = pruneProofFeedback(state, T0 + PROOF_FEEDBACK_TTL_MS + 200_000);

    expect(state).toEqual(EMPTY_PROOF_FEEDBACK_STATE);

    // The inbox still lists the old row: it stays out.
    const later = T0 + PROOF_FEEDBACK_TTL_MS + 300_000;

    expect(recordProofFeedback(state, warning(), later)).toBe(state);

    // A row inside the horizon still comes in.
    const recent = recordProofFeedback(
      state,
      warning({ notificationId: "notification-10", at: new Date(later - 60_000).toISOString() }),
      later,
    );

    expect(visibleProofFeedback(recent, DELIVERY)?.notificationId).toBe("notification-10");
  });
});

/**
 * The retake at the address: the driver tapped the push of a bad-photo
 * warning, the office reopened the delivery, and the driver took a new photo
 * that the reading flags in the same words. On Android the push is dated by
 * FCM's send time (the server side); the tap and every "heard" by the phone's
 * clock, which may be minutes off the server's.
 */
describe("a quick retake after a warning heard by push", () => {
  const server = (hms: string) => Date.parse(`2026-09-29T${hms}.000Z`);

  /** The phone's clock is the server's plus `skewMs`. */
  function retake(input: {
    skewMs: number;
    pushSentAt: string;
    pushTappedAt: string;
    proofTappedAt: string;
    newRowAt: string;
    newRowHeardAt: string;
    live: boolean;
  }): ProofFeedbackState {
    const phone = (hms: string) => server(hms) + input.skewMs;

    let state = recordProofFeedback(
      EMPTY_PROOF_FEEDBACK_STATE,
      warning({
        message: BAD_PHOTO,
        notificationId: null,
        at: new Date(server(input.pushSentAt)).toISOString(),
      }),
      phone(input.pushTappedAt),
    );

    state = markDeliveryProven(
      state,
      DELIVERY,
      phone(input.proofTappedAt),
      phone(input.proofTappedAt) + 2_000,
    );

    return recordProofFeedback(
      state,
      warning({
        message: BAD_PHOTO,
        notificationId: "notification-new",
        at: new Date(server(input.newRowAt)).toISOString(),
        live: input.live,
      }),
      phone(input.newRowHeardAt),
    );
  }

  const cases = [
    {
      name: "a 96 s cycle, clocks agreeing",
      skewMs: 0,
      pushSentAt: "12:00:04",
      pushTappedAt: "12:00:10",
      proofTappedAt: "12:01:30",
      newRowAt: "12:01:40",
    },
    {
      name: "a 2.5 min cycle, the phone 60 s ahead",
      skewMs: 60_000,
      pushSentAt: "12:00:04",
      pushTappedAt: "12:00:10",
      proofTappedAt: "12:02:00",
      newRowAt: "12:02:30",
    },
    {
      name: "a 4 min cycle, the phone 5 min ahead",
      skewMs: 5 * 60_000,
      pushSentAt: "12:00:04",
      pushTappedAt: "12:00:10",
      proofTappedAt: "12:03:00",
      newRowAt: "12:04:00",
    },
    {
      name: "a 3 min cycle, the phone 4 min behind",
      skewMs: -4 * 60_000,
      pushSentAt: "12:00:04",
      pushTappedAt: "12:00:10",
      proofTappedAt: "12:03:00",
      newRowAt: "12:03:10",
    },
  ];

  for (const scenario of cases) {
    it(`shows the new photo's warning over the socket: ${scenario.name}`, () => {
      const state = retake({ ...scenario, newRowHeardAt: scenario.newRowAt, live: true });

      expect(visibleProofFeedback(state, DELIVERY)?.notificationId).toBe("notification-new");
    });

    it(`shows the new photo's warning read from the inbox: ${scenario.name}`, () => {
      const state = retake({ ...scenario, newRowHeardAt: "12:30:00", live: false });

      expect(visibleProofFeedback(state, DELIVERY)?.notificationId).toBe("notification-new");
    });
  }

  it("still hides the replaced warning's own row, created after its push", () => {
    // The in-app row lagged the push by 20 s; the phone runs 5 min ahead.
    const skew = 5 * 60_000;

    let state = recordProofFeedback(
      EMPTY_PROOF_FEEDBACK_STATE,
      warning({ message: BAD_PHOTO, notificationId: null, at: "2026-09-29T12:00:04.000Z" }),
      server("12:00:10") + skew,
    );

    state = markDeliveryProven(state, DELIVERY, server("12:01:30") + skew, server("12:01:31") + skew);

    state = recordProofFeedback(
      state,
      warning({
        message: BAD_PHOTO,
        notificationId: "notification-old",
        at: "2026-09-29T12:00:24.000Z",
      }),
      server("12:10:00") + skew,
    );

    expect(visibleProofFeedback(state, DELIVERY)).toBeNull();
  });
});

describe("what the driver is told to do", () => {
  const heard = T0;

  it("checks the receipt while at the address when the delivery is proven", () => {
    expect(
      proofFeedbackStep({ receivedAt: heard, delivery: null, listUpdatedAt: heard + 1 }),
    ).toBe("review");
  });

  it("does not read a list older than the warning as a reopened delivery", () => {
    // The list still holds the delivery as it was before the proof.
    expect(
      proofFeedbackStep({
        receivedAt: heard,
        delivery: { status: "IN_TRANSIT" },
        listUpdatedAt: heard - 1,
      }),
    ).toBe("review");
  });

  it("asks for a new photo when the office reopened it in route", () => {
    expect(
      proofFeedbackStep({
        receivedAt: heard,
        delivery: { status: "IN_TRANSIT" },
        listUpdatedAt: heard + 60_000,
      }),
    ).toBe("retake");

    expect(
      proofFeedbackStep({
        receivedAt: heard,
        delivery: { status: "PENDING" },
        listUpdatedAt: heard + 60_000,
      }),
    ).toBe("start-route");
  });

  it("never says the delivery was refused: it is a suggestion the office reviews", () => {
    const review = proofFeedbackGuidance("review");

    expect(review).toContain("sugestão");
    expect(review).toContain("A equipe vai revisar o comprovante.");

    for (const step of ["review", "retake", "start-route"] as const) {
      expect(proofFeedbackGuidance(step)).not.toMatch(/recusad|rejeitad|reprovad/i);
    }

    expect(proofFeedbackGuidance("retake")).toContain("foto nítida do canhoto");
  });
});

describe("tapping the row in the inbox", () => {
  it("opens the delivery in the app, when this session can", () => {
    expect(notificationDeliveryTarget(row(), true)).toBe(DELIVERY);

    // Entregas switched off since: the row keeps its old behaviour.
    expect(notificationDeliveryTarget(row(), false)).toBeNull();

    expect(notificationDeliveryTarget(row({ type: "fine" }), true)).toBeNull();
    expect(notificationDeliveryTarget(row({ entityId: undefined }), true)).toBeNull();
  });
});
