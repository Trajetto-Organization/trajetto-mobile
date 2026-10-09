import { createRequire } from "node:module";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The hook `require`s the chime (an .aac asset, which Metro resolves to an
// id). Node would parse it as JavaScript; here it resolves to an id too.
const nodeRequire = createRequire(import.meta.url);
nodeRequire.extensions[".aac"] = (module) => {
  module.exports = 1;
};

/**
 * A proof warning that arrives with the app open, and one read from the inbox
 * (decision 6.9; docs/contratos-app/ai-feedback.md §2).
 *
 * Before, the socket row only bumped the bell and its toast opened the list;
 * nothing kept the warning for its delivery, the working list kept showing
 * the proven delivery in route until something else refreshed it, and the
 * inbox row's tap opened the web inbox. The real realtime hook runs outside a
 * renderer (as in notification-chime-foreground.test.ts); the store and its
 * rules are real, the disk is a Map.
 */
let runEffect: (() => void | (() => void)) | null = null;

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    runEffect = effect;
  },
}));

vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("expo-router", () => ({ useRouter: () => ({ navigate }) }));

vi.mock("expo-audio", () => ({
  createAudioPlayer: () => ({ seekTo: () => undefined, play: () => undefined }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("react-native-toast-message", () => ({ default: { show: toast } }));

const session = vi.hoisted(() => ({
  user: {
    id: "user-driver",
    businessId: "business-1",
    driverId: "driver-1",
    enabledModules: ["DELIVERIES"] as string[],
  },
}));

vi.mock("@/store/auth-store", () => {
  const useAuthStore = (select: (state: { isAuthenticated: boolean }) => unknown) =>
    select({ isAuthenticated: true });

  useAuthStore.getState = () => ({ user: session.user });

  return { useAuthStore };
});

const invalidateQueries = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries },
}));

vi.mock("@/features/notifications/use-notifications", () => ({
  applyIncomingNotification: () => undefined,
  applyNotificationsRead: () => undefined,
  refreshUnreadCount: () => undefined,
}));

const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

const handlers = new Map<string, (payload?: unknown) => void>();

vi.mock("@/utils/socket", () => ({
  initializeSocket: async () => ({
    on: (event: string, handler: (payload?: unknown) => void) =>
      handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
  }),
  onRealtimeResync: () => () => undefined,
}));

let useNotificationsRealtime: typeof import("@/features/notifications/use-notifications-realtime").useNotificationsRealtime;
let store: typeof import("@/features/notifications/proof-feedback-store");
let rules: typeof import("@/features/notifications/proof-feedback-rules");
let glue: typeof import("@/features/notifications/proof-feedback");

beforeAll(async () => {
  ({ useNotificationsRealtime } = await import(
    "@/features/notifications/use-notifications-realtime"
  ));
  store = await import("@/features/notifications/proof-feedback-store");
  rules = await import("@/features/notifications/proof-feedback-rules");
  glue = await import("@/features/notifications/proof-feedback");
});

const flush = async () => {
  for (let tick = 0; tick < 10; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const DELIVERY = "0192b1c4-0000-4000-8000-000000000001";
const OTHER = "0192b1c4-0000-4000-8000-000000000002";

const MESSAGE =
  "Entrega para Mercado Central. A leitura automática apontou: não foi encontrada assinatura. Se ainda estiver no local, confira o canhoto com o destinatário. A equipe vai revisar o comprovante.";

const proofRow = (overrides: Record<string, unknown> = {}) => ({
  id: "notification-1",
  type: "delivery-proof-ai",
  title: "Comprovante com possível problema",
  message: MESSAGE,
  read: false,
  entityId: DELIVERY,
  businessId: "business-1",
  // A minute ago: the store forgets rows past its offline horizon.
  created_at: new Date(Date.now() - 60_000).toISOString(),
  ...overrides,
});

const shown = (deliveryId: string) =>
  rules.visibleProofFeedback(
    store.scopedProofFeedback(
      store.useProofFeedbackStore.getState(),
      store.proofFeedbackScope("user-driver", "business-1"),
    ),
    deliveryId,
  );

async function mountRealtime(): Promise<void> {
  handlers.clear();
  useNotificationsRealtime();
  runEffect?.();
  await flush();
}

beforeEach(() => {
  navigate.mockReset();
  toast.mockReset();
  invalidateQueries.mockClear();
  session.user.enabledModules = ["DELIVERIES"];
  store.useProofFeedbackStore.setState({ byScope: {}, newProofs: {} });
});

describe("a proof warning over the socket", () => {
  it("is kept for its delivery, refreshes the list, and its toast opens the delivery", async () => {
    await mountRealtime();

    handlers.get("pushNotification")?.(proofRow());
    await flush();

    expect(shown(DELIVERY)).toMatchObject({
      notificationId: "notification-1",
      message: MESSAGE,
    });

    // A list fetched before the warning still shows the proven delivery in
    // route; the refetch takes it out (and tells a reopened one apart).
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["my-deliveries"] });

    const [[shownToast]] = toast.mock.calls as unknown as [[{ onPress: () => void }]];

    shownToast.onPress();

    expect(navigate).toHaveBeenCalledWith({
      pathname: "/delivery-detail",
      params: { id: DELIVERY },
    });
    expect(navigate).not.toHaveBeenCalledWith("/notifications");
  });

  it("leaves other notifications as they were", async () => {
    await mountRealtime();

    handlers.get("pushNotification")?.(
      proofRow({ id: "n-2", type: "service-order", entityId: OTHER }),
    );
    await flush();

    expect(shown(OTHER)).toBeNull();
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ["my-deliveries"] });

    const [[shownToast]] = toast.mock.calls as unknown as [[{ onPress: () => void }]];
    shownToast.onPress();

    expect(navigate).toHaveBeenCalledWith("/notifications");
  });
});

describe("the inbox rows", () => {
  it("bring the warnings the socket missed to their deliveries", async () => {
    glue.rememberProofFeedbackRows([
      proofRow(),
      proofRow({ id: "n-2", type: "fine", entityId: OTHER }),
      null,
    ]);
    await flush();

    expect(shown(DELIVERY)).toMatchObject({ notificationId: "notification-1" });
    expect(shown(OTHER)).toBeNull();
  });

  it("do not bring back a warning about a photo the driver already replaced", async () => {
    glue.rememberProofFeedbackRows([proofRow()]);
    await flush();

    // Reopened by the office and proven again from this phone.
    await store.markDeliveryProofSubmitted(DELIVERY, Date.now());

    expect(shown(DELIVERY)).toBeNull();

    // The same row read again from the inbox later.
    glue.rememberProofFeedbackRows([proofRow()]);
    await flush();

    expect(shown(DELIVERY)).toBeNull();
  });

  it("file each warning under the session that read it", async () => {
    glue.rememberProofFeedbackRows([proofRow()]);
    await flush();

    // Another driver on the same phone sees nothing of it.
    expect(
      rules.visibleProofFeedback(
        store.scopedProofFeedback(
          store.useProofFeedbackStore.getState(),
          store.proofFeedbackScope("user-other", "business-1"),
        ),
        DELIVERY,
      ),
    ).toBeNull();
  });
});
