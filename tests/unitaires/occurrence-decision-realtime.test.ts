import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tower's answer reaching the driver (decision 6.3; contract §5).
 *
 * The real `useDeliveryRealtime` runs outside a renderer (effects captured by
 * hand, as in proof-feedback-socket.test.ts) over a fake socket and a fake
 * query cache. Before, the hook read only `delivery.status_overridden` and
 * dropped `occurrence.authorization_decided` on the floor: the stop kept
 * "Aguardando autorização" and nobody told the driver the answer. The push
 * handlers of the same answer are driven here too, to pin that the driver is
 * told once whichever road arrives first.
 */

let runEffect: (() => void | (() => void)) | null = null;

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => {
    runEffect = effect;
  },
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("expo-router", () => ({ useRouter: () => ({ navigate }) }));

type ShownToast = {
  type: string;
  text1: string;
  text2?: string;
  onPress?: () => void;
};

const toast = vi.hoisted(() => vi.fn<[ShownToast], void>());
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
  const useAuthStore = (
    select: (state: { isAuthenticated: boolean; user: typeof session.user }) => unknown,
  ) => select({ isAuthenticated: true, user: session.user });

  useAuthStore.getState = () => ({ user: session.user });

  return { useAuthStore };
});

const cache = vi.hoisted(() => new Map<string, unknown>());
const invalidated = vi.hoisted(() => [] as unknown[][]);

vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    getQueryData: (key: unknown[]) => cache.get(JSON.stringify(key)),
    setQueryData: (key: unknown[], update: (old: unknown) => unknown) => {
      cache.set(JSON.stringify(key), update(cache.get(JSON.stringify(key))));
    },
    invalidateQueries: async ({ queryKey }: { queryKey: unknown[] }) => {
      invalidated.push(queryKey);
    },
  },
}));

const handlers = vi.hoisted(() => new Map<string, (payload?: unknown) => void>());

vi.mock("@/utils/socket", () => ({
  initializeSocket: async () => ({
    on: (event: string, handler: (payload?: unknown) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
  }),
}));

let useDeliveryRealtime: typeof import("@/features/deliveries/use-delivery-realtime").useDeliveryRealtime;
let decisions: typeof import("@/features/occurrences/occurrence-decision");

beforeAll(async () => {
  ({ useDeliveryRealtime } = await import("@/features/deliveries/use-delivery-realtime"));
  decisions = await import("@/features/occurrences/occurrence-decision");
});

const flush = async () => {
  for (let tick = 0; tick < 10; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const LIST_KEY = JSON.stringify(["my-deliveries", "business-1"]);

const request = (occurrenceId: string, overrides: Record<string, unknown> = {}) => ({
  occurrenceId,
  occurrenceTypeId: "type-ausente",
  occurrenceTypeName: "Cliente ausente",
  status: "PENDING",
  note: null,
  decidedAt: null,
  requestedAt: "2026-09-29T15:02:11.000Z",
  ...overrides,
});

function seedDay() {
  cache.set(LIST_KEY, {
    data: [
      {
        id: "delivery-1",
        recipient_name: "Mercado Central",
        status: "IN_TRANSIT",
        street: "Rua A",
        city: "Cuiabá",
        authorization_request: request("occ-1"),
      },
      {
        id: "delivery-2",
        recipient_name: "Padaria Sol",
        status: "IN_TRANSIT",
        street: "Rua B",
        city: "Cuiabá",
        authorization_request: request("occ-2"),
      },
    ],
    occurrence_types: [],
  });
}

const day = () =>
  (cache.get(LIST_KEY) as { data: Array<{ id: string; authorization_request: Record<string, unknown> | null }> })
    .data;

async function mount(): Promise<void> {
  runEffect = null;
  useDeliveryRealtime();
  (runEffect as (() => void | (() => void)) | null)?.();
  await flush();
}

const decided = (overrides: Record<string, unknown> = {}) => ({
  type: "occurrence.authorization_decided",
  deliveryId: "delivery-1",
  occurrenceId: "occ-1",
  decision: "DENIED",
  note: "Aguarde o cliente até 15h",
  deliveryStatus: "IN_TRANSIT",
  ...overrides,
});

beforeEach(() => {
  cache.clear();
  invalidated.length = 0;
  handlers.clear();
  toast.mockReset();
  navigate.mockReset();
  seedDay();
});

describe("the answer by socket, with the app open", () => {
  it("changes the stop, rereads the day and tells the driver what to do", async () => {
    await mount();

    handlers.get("deliveryEvent")?.(decided({ occurrenceId: "occ-1" }));

    expect(day()[0].authorization_request).toMatchObject({
      occurrenceId: "occ-1",
      status: "DENIED",
      note: "Aguarde o cliente até 15h",
      decidedAt: expect.any(String),
    });
    expect(day()[1].authorization_request?.status).toBe("PENDING");

    expect(invalidated).toContainEqual(["my-deliveries", "business-1"]);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({
      type: "error",
      text1: "Ocorrência não autorizada",
      text2:
        "Mercado Central: Aguarde o cliente até 15h. A entrega continua em rota: siga a orientação da torre ou fale com a base.",
    });

    // The toast opens the delivery, still to be worked.
    toast.mock.calls[0][0].onPress?.();
    expect(navigate).toHaveBeenCalledWith({
      pathname: "/delivery-detail",
      params: { id: "delivery-1" },
    });
  });

  it("an approval that failed the delivery sends the driver to the day's list", async () => {
    // Its own request: each answer is announced once per process.
    day()[1].authorization_request = request("occ-20");

    await mount();

    handlers.get("deliveryEvent")?.(
      decided({ occurrenceId: "occ-20", deliveryId: "delivery-2", decision: "APPROVED", note: null, deliveryStatus: "FAILED" }),
    );

    expect(toast.mock.calls[0][0]).toMatchObject({
      type: "success",
      text1: "Ocorrência autorizada",
      text2: "Padaria Sol: entrega registrada como Insucesso. Siga para a próxima parada.",
    });

    toast.mock.calls[0][0].onPress?.();
    expect(navigate).toHaveBeenCalledWith("/deliveries");
  });

  it("the panel's status override is still announced as before", async () => {
    await mount();

    handlers.get("deliveryEvent")?.({
      type: "delivery.status_overridden",
      deliveryId: "delivery-1",
      status: "CANCELLED",
      removedFromWorklist: true,
    });

    expect(toast.mock.calls[0][0]).toMatchObject({ text1: "Entrega retirada da sua lista" });
  });
});

describe("the same answer by push", () => {
  const push = (occurrenceId: string, decision = "APPROVED") => ({
    title: decision === "APPROVED" ? "✅ Ocorrência autorizada" : "⛔ Ocorrência não autorizada",
    body: "Cliente ausente — Mercado Central: pode seguir. Deixe com o porteiro.",
    // The pipeline stamps its own record id over `deliveryId`.
    data: { url: "/deliveries", deliveryId: "pipeline-row-id", occurrenceId, decision },
  });

  it("after the socket said it, changes nothing more on screen", async () => {
    await mount();

    handlers.get("deliveryEvent")?.(decided({ occurrenceId: "occ-3", deliveryId: "delivery-9" }));
    toast.mockReset();

    expect(decisions.handleOccurrenceDecisionPush(push("occ-3", "DENIED"), navigate)).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it("with the socket down, shows the answer in the push's words and finds the stop by its request", async () => {
    const opened = vi.fn();

    expect(decisions.handleOccurrenceDecisionPush(push("occ-2"), opened)).toBe(true);

    expect(day()[1].authorization_request).toMatchObject({ status: "APPROVED", note: null });
    expect(invalidated).toContainEqual(["my-deliveries", "business-1"]);

    expect(toast.mock.calls[0][0]).toMatchObject({
      type: "success",
      text1: "✅ Ocorrência autorizada",
      text2: "Cliente ausente — Mercado Central: pode seguir. Deixe com o porteiro.",
    });

    toast.mock.calls[0][0].onPress?.();
    expect(opened).toHaveBeenCalledWith("delivery-2");
  });

  it("tapped in the tray: the stop changes and the delivery opens, without a toast", () => {
    const opened = vi.fn();

    expect(decisions.openOccurrenceDecisionPush(push("occ-1", "DENIED"), opened)).toBe(true);

    expect(day()[0].authorization_request?.status).toBe("DENIED");
    expect(opened).toHaveBeenCalledWith("delivery-1");
    expect(toast).not.toHaveBeenCalled();
  });

  it("an answer this phone does not know opens the day's list, which rereads it", () => {
    const opened = vi.fn();

    expect(decisions.openOccurrenceDecisionPush(push("occ-unknown"), opened)).toBe(true);
    expect(opened).toHaveBeenCalledWith(null);
    expect(invalidated).toContainEqual(["my-deliveries", "business-1"]);
  });

  it("is not this session's to open without Entregas", () => {
    const previous = session.user.enabledModules;
    session.user.enabledModules = ["FLEET"];

    try {
      expect(decisions.openOccurrenceDecisionPush(push("occ-1"), vi.fn())).toBe(false);
      expect(day()[0].authorization_request?.status).toBe("PENDING");
    } finally {
      session.user.enabledModules = previous;
    }
  });

  it("any other push is left alone", () => {
    expect(decisions.handleOccurrenceDecisionPush({ data: { url: "/chat" } }, vi.fn())).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});
