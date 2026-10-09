import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A tapped proof warning opens the delivery it is about (decision 6.9;
 * docs/contratos-app/ai-feedback.md §1).
 *
 * The push says `url: "/deliveries"` and names the delivery in
 * `data.entityId`. The app sent every push that was not a chat to the
 * notifications list, where the row's link opens the WEB inbox — the driver
 * never reached the delivery. Runs the real hook, effects captured by hand
 * (as in push-response-relogin.test.ts), with expo-notifications faked.
 */
let effects: Array<() => void | (() => void)> = [];

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    effects.push(effect);
  },
}));

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: "android" },
}));

vi.mock("expo-constants", () => ({
  default: { executionEnvironment: "standalone", expoConfig: {} },
  ExecutionEnvironment: { StoreClient: "storeClient" },
}));

vi.mock("expo-device", () => ({ isDevice: false }));

const navigate = vi.fn();

vi.mock("expo-router", () => ({ useRouter: () => ({ navigate }) }));

type Tap = {
  notification: {
    date?: number;
    request: {
      identifier: string;
      content: { title?: string; body?: string; data?: Record<string, unknown> };
    };
  };
};

let responseListener: ((response: Tap) => void) | null = null;

vi.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: (listener: (response: Tap) => void) => {
    responseListener = listener;
    return { remove: () => undefined };
  },
  getLastNotificationResponseAsync: async () => null,
  clearLastNotificationResponse: () => undefined,
}));

let sessionUser: {
  id: string;
  businessId: string;
  driverId: string;
  enabledModules: string[];
} = {
  id: "user-driver",
  businessId: "business-1",
  driverId: "driver-1",
  enabledModules: ["DELIVERIES"],
};

vi.mock("@/store/auth-store", () => ({
  useAuthStore: { getState: () => ({ user: sessionUser }) },
}));

const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

vi.mock("@/utils/api", () => ({ apiClient: { request: async () => ({}) } }));
vi.mock("@/utils/logger", () => ({ logger: { dev: () => undefined } }));
vi.mock("@/utils/push-token", () => ({ setRegisteredPushToken: () => undefined }));
vi.mock("@/store/connection-store", () => ({
  useConnectionStore: { subscribe: () => () => undefined },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const DELIVERY = "0192b1c4-0000-4000-8000-000000000001";

const MESSAGE =
  "Entrega para Mercado Central. A leitura automática apontou: não foi encontrada assinatura. Se ainda estiver no local, confira o canhoto com o destinatário. A equipe vai revisar o comprovante.";

/** When FCM sent the push: the tray's `date` on Android (`google.sent_time`). */
let sentAt = Date.now() - 3_000;

function proofPush(identifier: string, deliveryId = DELIVERY): Tap {
  return {
    notification: {
      date: sentAt,
      request: {
        identifier,
        content: {
          title: "Comprovante com possível problema",
          body: MESSAGE,
          data: {
            url: "/deliveries",
            type: "delivery-proof.ai-flagged",
            entityId: deliveryId,
            // The pipeline's own id, stamped on every push: not the delivery.
            deliveryId: "0192b1c4-0000-4000-8000-0000000000ff",
          },
        },
      },
    },
  };
}

async function mount(): Promise<void> {
  const { usePushNotifications } = await import(
    "@/features/notifications/use-push-notifications"
  );

  effects = [];
  responseListener = null;

  usePushNotifications();
  effects.forEach((effect) => effect());

  for (let tick = 0; tick < 200 && !responseListener; tick += 1) await flush();
}

beforeEach(() => {
  sentAt = Date.now() - 3_000;
  navigate.mockReset();
  sessionUser = { ...sessionUser, enabledModules: ["DELIVERIES"] };
});

describe("a tapped proof warning", () => {
  it("opens the delivery over the day's list, and keeps the warning for it", async () => {
    await mount();

    responseListener?.(proofPush("proof-1"));

    expect(navigate.mock.calls).toEqual([
      ["/deliveries"],
      [{ pathname: "/delivery-detail", params: { id: DELIVERY } }],
    ]);

    // The delivery shows it from the push's own text, before the inbox row.
    for (let tick = 0; tick < 20; tick += 1) await flush();

    const { useProofFeedbackStore, scopedProofFeedback, proofFeedbackScope } =
      await import("@/features/notifications/proof-feedback-store");
    const { visibleProofFeedback } = await import(
      "@/features/notifications/proof-feedback-rules"
    );

    const kept = visibleProofFeedback(
      scopedProofFeedback(
        useProofFeedbackStore.getState(),
        proofFeedbackScope("user-driver", "business-1"),
      ),
      DELIVERY,
    );

    expect(kept).toMatchObject({
      deliveryId: DELIVERY,
      message: MESSAGE,
      notificationId: null,
      // Dated by when it was sent, not by the tap.
      at: new Date(sentAt).toISOString(),
      live: false,
    });

    // And it is on disk, for after the app is killed.
    expect([...disk.keys()]).toContain("@trajetto:proof-feedback:v1");
  });

  it("opens the delivery but keeps nothing when the push carries no send date", async () => {
    // Every Android push has one (FCM's google.sent_time); without it the
    // only moment left is the phone's, which the rules never compare.
    const undated = "0192b1c4-0000-4000-8000-000000000009";

    await mount();

    const tap = proofPush("proof-undated", undated);
    delete tap.notification.date;

    responseListener?.(tap);

    expect(navigate.mock.calls).toEqual([
      ["/deliveries"],
      [{ pathname: "/delivery-detail", params: { id: undated } }],
    ]);

    for (let tick = 0; tick < 20; tick += 1) await flush();

    const { useProofFeedbackStore } = await import(
      "@/features/notifications/proof-feedback-store"
    );

    const kept = Object.values(useProofFeedbackStore.getState().byScope).flatMap(
      (byDelivery) => Object.keys(byDelivery),
    );

    expect(kept).not.toContain(undated);
  });

  it("opens the notifications list when the session no longer has Entregas", async () => {
    sessionUser = { ...sessionUser, enabledModules: ["FLEET"] };

    await mount();

    responseListener?.(proofPush("proof-2"));

    expect(navigate.mock.calls).toEqual([["/notifications"]]);
  });

  it("leaves every other push where it went", async () => {
    await mount();

    responseListener?.({
      notification: {
        request: { identifier: "chat-1", content: { data: { url: "/chat" } } },
      },
    });

    expect(navigate.mock.calls).toEqual([["/chat"]]);
  });
});
