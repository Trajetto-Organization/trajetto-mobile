import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The warning about a photo, against the proof the driver just sent
 * (decision 6.9; docs/contratos-app/ai-feedback.md).
 *
 * A new proof hides the warning about the photo it replaces. Before, the
 * proof action stamped that moment with the phone's clock once the send had
 * settled, and the rules compared it with the server's `created_at`. So the
 * warning about the very photo just sent vanished from the delivery when the
 * phone's clock ran a few seconds ahead, or when the proof's answer (or the
 * timeout that queued it) landed after the warning.
 *
 * The proof action runs for real, with the network edge (`submitOrQueue`)
 * and the native modules replaced; the warnings arrive through the real
 * glue, into the real store and rules. The disk is a Map.
 */

vi.mock("react", () => ({
  useState: <T,>(initial: T) => [initial, () => undefined],
}));

// The proof's phone id (proof design §8): resolved at once here, so the
// tap-to-send timing this file pins is not the native modules' load time.
vi.mock("@/features/device/device-identity", () => ({
  deviceIdentity: async () => null,
}));

vi.mock("expo-crypto", () => ({
  randomUUID: () => "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
}));
vi.mock("expo-haptics", () => ({
  impactAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
  getCurrentPositionAsync: async () => ({
    coords: { latitude: -23.55, longitude: -46.63 },
  }),
  getLastKnownPositionAsync: async () => null,
  Accuracy: { Balanced: 3 },
  PermissionStatus: { GRANTED: "granted" },
}));
vi.mock("react-native-toast-message", () => ({ default: { show: () => undefined } }));
vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    invalidateQueries: async () => undefined,
    setQueryData: () => undefined,
  },
}));

vi.mock("@/store/auth-store", () => {
  const user = {
    id: "user-driver",
    businessId: "business-1",
    driverId: "driver-1",
    enabledModules: ["DELIVERIES"],
  };

  const useAuthStore = (select: (state: { user: typeof user }) => unknown) =>
    select({ user });

  useAuthStore.getState = () => ({ user });

  return { useAuthStore };
});

const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

/** What the network edge does with the next proof. */
let edge: () => Promise<"sent" | "queued"> = async () => "sent";

const submitOrQueue = vi.fn((_input: { body: Record<string, unknown> }) => edge());

vi.mock("@/features/submissions/submit-or-queue", () => ({
  submitOrQueue: (input: { body: Record<string, unknown> }) => submitOrQueue(input),
}));

let useDeliveryActions: typeof import("@/features/deliveries/hooks/use-delivery-actions").useDeliveryActions;
let store: typeof import("@/features/notifications/proof-feedback-store");
let rules: typeof import("@/features/notifications/proof-feedback-rules");
let glue: typeof import("@/features/notifications/proof-feedback");

beforeAll(async () => {
  ({ useDeliveryActions } = await import(
    "@/features/deliveries/hooks/use-delivery-actions"
  ));
  store = await import("@/features/notifications/proof-feedback-store");
  rules = await import("@/features/notifications/proof-feedback-rules");
  glue = await import("@/features/notifications/proof-feedback");

  await store.hydrateProofFeedbackStore();
});

const flush = async () => {
  for (let tick = 0; tick < 10; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const MESSAGE =
  "Entrega para Mercado Central. A leitura automática apontou: não foi encontrada assinatura. Se ainda estiver no local, confira o canhoto com o destinatário. A equipe vai revisar o comprovante.";

const photo = {
  uri: "file:///canhoto.jpg",
  fileName: "canhoto.jpg",
  fileSize: 1024,
  mimeType: "image/jpeg",
};

const BAD_PHOTO =
  "Entrega para Mercado Central. A leitura automática apontou: a foto está ruim demais para leitura. Se ainda estiver no local, confira o canhoto com o destinatário. A equipe vai revisar o comprovante.";

/** The inbox row (or its socket twin) of a warning, dated by the server. */
const warningRow = (
  deliveryId: string,
  id: string,
  createdAt: string,
  message = MESSAGE,
) => ({
  id,
  type: "delivery-proof-ai",
  title: "Comprovante com possível problema",
  message,
  read: false,
  entityId: deliveryId,
  businessId: "business-1",
  created_at: createdAt,
});

const shown = (deliveryId: string) =>
  rules.visibleProofFeedback(
    store.scopedProofFeedback(
      store.useProofFeedbackStore.getState(),
      store.proofFeedbackScope("user-driver", "business-1"),
    ),
    deliveryId,
  );

const prove = (deliveryId: string) =>
  useDeliveryActions("business-1").submitProof({
    deliveryId,
    recipientName: "Mercado Central",
    photo,
  });

const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  submitOrQueue.mockClear();
  edge = async () => "sent";
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the warning about the photo just sent", () => {
  it("stays on the delivery when it arrives before the send settles", async () => {
    const delivery = "0192b1c4-0000-4000-8000-000000000011";

    // Tapped at 12:00:00; the answer is slow.
    at("2026-09-29T12:00:00.000Z");

    let settle: (outcome: "sent" | "queued") => void = () => undefined;

    edge = () =>
      new Promise((resolve) => {
        settle = resolve;
      });

    const done = prove(delivery);
    await flush();

    expect(submitOrQueue).toHaveBeenCalledTimes(1);

    // The reading warns about this very photo while the send is in flight.
    at("2026-09-29T12:00:06.000Z");
    glue.handleProofFeedbackNotification(
      warningRow(delivery, "notification-11", "2026-09-29T12:00:05.000Z"),
    );
    await flush();

    // The 20 s timeout ends it queued, after the warning.
    at("2026-09-29T12:00:20.000Z");
    settle("queued");

    expect(await done).toBe(true);
    await flush();

    expect(shown(delivery)?.notificationId).toBe("notification-11");
  });

  it("stays on the delivery when the phone's clock runs ahead of the server's", async () => {
    const delivery = "0192b1c4-0000-4000-8000-000000000012";

    // The phone reads 12:00:10 when the server reads 12:00:00.
    at("2026-09-29T12:00:10.000Z");

    expect(await prove(delivery)).toBe(true);
    await flush();

    // Warned at 12:00:05 by the server's clock, heard at once.
    at("2026-09-29T12:00:16.000Z");
    glue.handleProofFeedbackNotification(
      warningRow(delivery, "notification-12", "2026-09-29T12:00:05.000Z"),
    );
    await flush();

    expect(shown(delivery)?.notificationId).toBe("notification-12");

    // The proof went out with the tap's own moment.
    expect(submitOrQueue.mock.calls[0][0].body.occurred_at).toBe(
      "2026-09-29T12:00:10.000Z",
    );
  });
});

describe("the warning about a photo a new proof replaced", () => {
  it("stops showing, and the inbox does not bring it back", async () => {
    const delivery = "0192b1c4-0000-4000-8000-000000000013";

    at("2026-09-29T12:00:06.000Z");
    glue.rememberProofFeedbackRows([
      warningRow(delivery, "notification-13", "2026-09-29T12:00:05.000Z"),
    ]);
    await flush();

    expect(shown(delivery)?.notificationId).toBe("notification-13");

    // Reopened by the office, proven again from this phone three minutes on.
    at("2026-09-29T12:03:00.000Z");
    expect(await prove(delivery)).toBe(true);
    await flush();

    expect(shown(delivery)).toBeNull();

    // The same row read again from the inbox.
    at("2026-09-29T12:04:00.000Z");
    glue.rememberProofFeedbackRows([
      warningRow(delivery, "notification-13", "2026-09-29T12:00:05.000Z"),
    ]);
    await flush();

    expect(shown(delivery)).toBeNull();

    // A warning about the new photo shows.
    at("2026-09-29T12:05:00.000Z");
    glue.handleProofFeedbackNotification(
      warningRow(delivery, "notification-14", "2026-09-29T12:04:50.000Z"),
    );
    await flush();

    expect(shown(delivery)?.notificationId).toBe("notification-14");
  });
});

/** The push of a warning, as the tray hands it over. */
const warningPush = (deliveryId: string, message = MESSAGE) => ({
  title: "Comprovante com possível problema",
  body: message,
  data: {
    url: "/deliveries",
    type: "delivery-proof.ai-flagged",
    entityId: deliveryId,
    // The pipeline's own id, stamped on every push: not the delivery.
    deliveryId: "0192b1c4-0000-4000-8000-0000000000ff",
  },
});

const server = (hms: string) => Date.parse(`2026-09-29T${hms}.000Z`);

/**
 * The retake at the address, the flow the bad-photo warning exists for: the
 * app was in the background, the driver tapped the push, the office reopened
 * the delivery, and the new photo is flagged in the same words.
 *
 * On Android the push is dated by when FCM sent it (`google.sent_time`), the
 * server's side; the tap and every "heard" by the phone's clock. Before, a
 * warning held from a push was compared with the new row within ±2 min of
 * its date, and the new photo's warning was dropped for good.
 */
describe("a quick retake after a warning heard by push", () => {
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
  ];

  let sequence = 0;

  for (const scenario of cases) {
    for (const road of ["socket", "inbox"] as const) {
      it(`shows the new photo's warning (${road}): ${scenario.name}`, async () => {
        sequence += 1;

        const delivery = `0192b1c4-0000-4000-8000-0000000002${String(sequence).padStart(2, "0")}`;
        const phone = (hms: string) =>
          at(new Date(server(hms) + scenario.skewMs).toISOString());

        // The push, tapped from the tray.
        phone(scenario.pushTappedAt);
        glue.rememberProofFeedbackPush(
          warningPush(delivery, BAD_PHOTO),
          new Date(server(scenario.pushSentAt)),
        );
        await flush();

        expect(shown(delivery)?.message).toBe(BAD_PHOTO);

        // Reopened; the new photo, proven from this phone.
        phone(scenario.proofTappedAt);
        expect(await prove(delivery)).toBe(true);
        await flush();

        expect(shown(delivery)).toBeNull();

        // The reading of the NEW photo, in the same words: over the socket
        // at once, or read from the inbox a while later.
        const row = warningRow(
          delivery,
          `notification-new-${sequence}`,
          new Date(server(scenario.newRowAt)).toISOString(),
          BAD_PHOTO,
        );

        if (road === "socket") {
          phone(scenario.newRowAt);
          glue.handleProofFeedbackNotification(row);
        } else {
          phone("12:20:00");
          glue.rememberProofFeedbackRows([row]);
        }
        await flush();

        expect(shown(delivery)?.notificationId).toBe(`notification-new-${sequence}`);

        // The replaced warning's own row, read from the inbox, stays out.
        glue.rememberProofFeedbackRows([
          warningRow(
            delivery,
            `notification-old-${sequence}`,
            new Date(server(scenario.pushSentAt) - 1_000).toISOString(),
            BAD_PHOTO,
          ),
        ]);
        await flush();

        expect(shown(delivery)?.notificationId).toBe(`notification-new-${sequence}`);
      });
    }
  }

  it("shows it over the socket even were the push dated by the phone's clock", async () => {
    // The review's reading of the 5-min case: the push dated 12:05:04, the
    // phone's time for the server's 12:00:04. The socket road never reads it.
    const delivery = "0192b1c4-0000-4000-8000-000000000299";

    at("2026-09-29T12:05:10.000Z");
    glue.rememberProofFeedbackPush(
      warningPush(delivery, BAD_PHOTO),
      new Date("2026-09-29T12:05:04.000Z"),
    );
    await flush();

    at("2026-09-29T12:08:00.000Z");
    expect(await prove(delivery)).toBe(true);
    await flush();

    at("2026-09-29T12:09:01.000Z");
    glue.handleProofFeedbackNotification(
      warningRow(delivery, "notification-299", "2026-09-29T12:04:00.000Z", BAD_PHOTO),
    );
    await flush();

    expect(shown(delivery)?.notificationId).toBe("notification-299");
  });
});

describe("the tap on 'Comprovar' against the warning held", () => {
  it("keeps apart the new photo's warning that lands while the send is in flight", async () => {
    const delivery = "0192b1c4-0000-4000-8000-000000000301";

    // The old photo's warning, heard by push.
    at("2026-09-29T12:00:10.000Z");
    glue.rememberProofFeedbackPush(
      warningPush(delivery),
      new Date("2026-09-29T12:00:04.000Z"),
    );
    await flush();

    // The new proof, with a slow answer.
    at("2026-09-29T12:02:00.000Z");

    let settle: (outcome: "sent" | "queued") => void = () => undefined;

    edge = () =>
      new Promise((resolve) => {
        settle = resolve;
      });

    const done = prove(delivery);
    await flush();

    // The new photo, flagged in the same words before the answer lands.
    at("2026-09-29T12:02:08.000Z");
    glue.handleProofFeedbackNotification(
      warningRow(delivery, "notification-301", "2026-09-29T12:02:07.000Z"),
    );
    await flush();

    at("2026-09-29T12:02:20.000Z");
    settle("sent");

    expect(await done).toBe(true);
    await flush();

    // Not merged into the old warning and hidden with it.
    expect(shown(delivery)).toMatchObject({
      notificationId: "notification-301",
      receivedAt: Date.parse("2026-09-29T12:02:08.000Z"),
    });
  });

  it("gives the old warning back when the proof is refused on its merits", async () => {
    const delivery = "0192b1c4-0000-4000-8000-000000000302";

    at("2026-09-29T12:00:06.000Z");
    glue.rememberProofFeedbackRows([
      warningRow(delivery, "notification-302", "2026-09-29T12:00:05.000Z"),
    ]);
    await flush();

    at("2026-09-29T12:03:00.000Z");
    edge = async () => {
      throw new Error("Entrega já comprovada.");
    };

    expect(await prove(delivery)).toBe(false);
    await flush();

    // The old photo stands, and so does its warning.
    expect(shown(delivery)?.notificationId).toBe("notification-302");
  });
});
