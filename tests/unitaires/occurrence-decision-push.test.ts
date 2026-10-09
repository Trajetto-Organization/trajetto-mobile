import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tower's answer as a push (decision 6.3; contract §5), through the real
 * `usePushNotifications` (effects captured by hand, as in
 * proof-feedback-push.test.ts) with expo-notifications faked.
 *
 * Before, a tapped answer only opened the day's list, whatever the stop, and
 * one received with the app open showed nothing at all: the foreground
 * banner is off, and without the socket the stop kept "Aguardando
 * autorização" until something else reread the day.
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

type Content = { title?: string; body?: string; data?: Record<string, unknown> };
type Tap = { notification: { date?: number; request: { identifier: string; content: Content } } };

let responseListener: ((response: Tap) => void) | null = null;
let receivedListener: ((notification: Tap["notification"]) => void) | null = null;

vi.mock("expo-notifications", () => ({
  addNotificationResponseReceivedListener: (listener: (response: Tap) => void) => {
    responseListener = listener;
    return { remove: () => undefined };
  },
  addNotificationReceivedListener: (listener: (notification: Tap["notification"]) => void) => {
    receivedListener = listener;
    return { remove: () => undefined };
  },
  getLastNotificationResponseAsync: async () => null,
  clearLastNotificationResponse: () => undefined,
}));

const sessionUser = {
  id: "user-driver",
  businessId: "business-1",
  driverId: "driver-1",
  enabledModules: ["DELIVERIES"],
};

vi.mock("@/store/auth-store", () => ({
  useAuthStore: { getState: () => ({ user: sessionUser }) },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

const toast = vi.fn();
vi.mock("react-native-toast-message", () => ({ default: { show: (shown: unknown) => toast(shown) } }));

const cache = new Map<string, unknown>();

vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    getQueryData: (key: unknown[]) => cache.get(JSON.stringify(key)),
    setQueryData: (key: unknown[], update: (old: unknown) => unknown) => {
      cache.set(JSON.stringify(key), update(cache.get(JSON.stringify(key))));
    },
    invalidateQueries: async () => undefined,
  },
}));

vi.mock("@/utils/api", () => ({ apiClient: { request: async () => ({}) } }));
vi.mock("@/utils/logger", () => ({ logger: { dev: () => undefined } }));
vi.mock("@/utils/push-token", () => ({ setRegisteredPushToken: () => undefined }));
vi.mock("@/store/connection-store", () => ({
  useConnectionStore: { subscribe: () => () => undefined },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async () => {
  for (let tick = 0; tick < 50; tick += 1) await flush();
};

const LIST_KEY = JSON.stringify(["my-deliveries", "business-1"]);

function seedDay(occurrenceId: string, occurrenceTypes: unknown[] = []) {
  cache.set(LIST_KEY, {
    data: [
      {
        id: "delivery-1",
        recipient_name: "Mercado Central",
        status: "IN_TRANSIT",
        authorization_request: {
          occurrenceId,
          occurrenceTypeId: "type-ausente",
          occurrenceTypeName: "Cliente ausente",
          status: "PENDING",
          note: null,
          decidedAt: null,
          requestedAt: "2026-09-29T15:02:11.000Z",
        },
      },
    ],
    occurrence_types: occurrenceTypes,
  });
}

const status = () =>
  (cache.get(LIST_KEY) as { data: Array<{ authorization_request: { status: string } }> }).data[0]
    .authorization_request.status;

const decisionPush = (
  identifier: string,
  occurrenceId: string,
  decision = "DENIED",
  extra: Record<string, unknown> = {},
): Tap => ({
  notification: {
    request: {
      identifier,
      content: {
        title: "⛔ Ocorrência não autorizada",
        body: "Cliente ausente — Mercado Central: Aguarde o cliente.",
        data: {
          url: "/deliveries",
          // The pipeline's own record id, stamped over the policy's.
          deliveryId: "pipeline-row",
          occurrenceId,
          decision,
          ...extra,
        },
      },
    },
  },
});

async function mount(): Promise<void> {
  const { usePushNotifications } = await import("@/features/notifications/use-push-notifications");

  effects = [];
  responseListener = null;
  receivedListener = null;

  usePushNotifications();
  effects.forEach((effect) => effect());

  for (let tick = 0; tick < 200 && !receivedListener; tick += 1) await flush();
}

beforeEach(() => {
  navigate.mockReset();
  toast.mockReset();
  cache.clear();
});

describe("a decision push", () => {
  it("tapped: changes the stop and opens the delivery over the day's list", async () => {
    seedDay("occ-tap");
    await mount();

    responseListener?.(decisionPush("tap-1", "occ-tap"));
    await settle();

    expect(status()).toBe("DENIED");
    expect(navigate.mock.calls).toEqual([
      ["/deliveries"],
      [{ pathname: "/delivery-detail", params: { id: "delivery-1" } }],
    ]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("received with the app open: changes the stop and shows the answer", async () => {
    seedDay("occ-open");
    await mount();

    receivedListener?.(decisionPush("open-1", "occ-open", "APPROVED").notification);
    await settle();

    expect(status()).toBe("APPROVED");
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      text1: "⛔ Ocorrência não autorizada",
      text2: "Cliente ausente — Mercado Central: Aguarde o cliente.",
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  // Before: the toast repeated the push body, which says "pode seguir" for
  // any approval — with the socket down, the driver was told to carry on
  // while the stop said the delivery was Insucesso.
  it("received with the app open, an approval that ended the delivery says so, note kept", async () => {
    seedDay("occ-ended", [{ id: "type-ausente", name: "Cliente ausente", blocks_delivery: true }]);
    await mount();

    const approved = decisionPush("open-ended", "occ-ended", "APPROVED");
    approved.notification.request.content = {
      ...approved.notification.request.content,
      title: "✅ Ocorrência autorizada",
      body: "Cliente ausente — Mercado Central: pode seguir. Devolva a mercadoria à base.",
    };

    receivedListener?.(approved.notification);
    await settle();

    expect(status()).toBe("APPROVED");
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      type: "success",
      text1: "✅ Ocorrência autorizada",
      text2:
        "Mercado Central: entrega registrada como Insucesso. Siga para a próxima parada. Devolva a mercadoria à base.",
    });

    // The toast's tap opens the day's list, not the delivery that ended.
    (toast.mock.calls[0][0] as { onPress: () => void }).onPress();
    expect(navigate.mock.calls).toEqual([["/deliveries"]]);
  });

  // Before: the push carries no delivery status, so every tapped approval
  // opened the delivery — including one that FAILED it (a blocking type),
  // which the reread then removes from under the driver.
  it("tapped approval of a type the day knows as blocking: the list opens, not the ended delivery", async () => {
    seedDay("occ-blocking", [{ id: "type-ausente", name: "Cliente ausente", blocks_delivery: true }]);
    await mount();

    responseListener?.(decisionPush("tap-blocking", "occ-blocking", "APPROVED"));
    await settle();

    expect(status()).toBe("APPROVED");
    expect(navigate.mock.calls).toEqual([["/deliveries"]]);
  });

  it("the status is taken from the push when the API sends it", async () => {
    seedDay("occ-status");
    await mount();

    responseListener?.(
      decisionPush("tap-status", "occ-status", "APPROVED", { deliveryStatus: "FAILED" }),
    );
    await settle();

    expect(navigate.mock.calls).toEqual([["/deliveries"]]);
  });

  it("an approval of a type that does not block still opens the delivery", async () => {
    seedDay("occ-open-type", [{ id: "type-ausente", name: "Cliente ausente", blocks_delivery: false }]);
    await mount();

    responseListener?.(decisionPush("tap-open-type", "occ-open-type", "APPROVED"));
    await settle();

    expect(navigate.mock.calls).toEqual([
      ["/deliveries"],
      [{ pathname: "/delivery-detail", params: { id: "delivery-1" } }],
    ]);
  });

  it("any other push goes where it went, and a received one does nothing", async () => {
    await mount();

    responseListener?.({
      notification: { request: { identifier: "chat-1", content: { data: { url: "/chat" } } } },
    });
    receivedListener?.({ request: { identifier: "chat-2", content: { data: { url: "/chat" } } } });
    await settle();

    expect(navigate.mock.calls).toEqual([["/chat"]]);
    expect(toast).not.toHaveBeenCalled();
  });
});
