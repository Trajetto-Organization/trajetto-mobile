import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the driver's actions let into the offline queue, and how long they
 * make the driver wait for a GPS fix.
 *
 * The hook is driven for real — its location capture, its validation, its
 * body building — with the network edge (`submitOrQueue`) and the native
 * modules replaced.
 *
 * - MOB-13: `getCurrentPositionAsync` has no timeout. In a basement "Cheguei"
 *   and the proof spun for as long as the GPS took, which can be forever.
 * - DLV-ST-2 / DLVP-OCC-2: "Quem recebeu" and the description were only
 *   trimmed. The API refuses a double space; queued offline, that 400 was a
 *   permanent failure — a proof of delivery the driver could only discard.
 * - MOB-04: the departure goes to the route the driver pressed.
 * - MOB-19: the arrival is marked on the cached list at once.
 */

vi.mock("react", () => ({
  useState: <T,>(initial: T) => [initial, () => undefined],
}));

const SUBMISSION_ID = "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01";

vi.mock("expo-crypto", () => ({ randomUUID: () => SUBMISSION_ID }));
vi.mock("expo-haptics", () => ({
  impactAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: "light" },
}));

type Fix = {
  coords: { latitude: number; longitude: number };
  timestamp?: number;
} | null;

const gps = {
  permission: "granted",
  current: (): Promise<Fix> =>
    Promise.resolve({ coords: { latitude: -23.55, longitude: -46.63 } }),
  lastKnown: (): Promise<Fix> => Promise.resolve(null),
};

vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: async () => ({ status: gps.permission }),
  getCurrentPositionAsync: () => gps.current(),
  getLastKnownPositionAsync: () => gps.lastKnown(),
  Accuracy: { Balanced: 3 },
  PermissionStatus: { GRANTED: "granted" },
}));

const toasts: Array<{ type: string; text1: string; text2?: string }> = [];

vi.mock("react-native-toast-message", () => ({
  default: { show: (toast: { type: string; text1: string; text2?: string }) => toasts.push(toast) },
}));

let cachedList: unknown = undefined;

vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    invalidateQueries: async () => undefined,
    setQueryData: (_key: unknown, update: (old: unknown) => unknown) => {
      cachedList = update(cachedList);
    },
  },
}));

const submitOrQueue = vi.fn(
  async (_input: { endpoint: string; body: Record<string, unknown>; submissionId: string }) =>
    "queued" as const,
);

vi.mock("@/features/submissions/submit-or-queue", () => ({
  submitOrQueue: (input: { endpoint: string; body: Record<string, unknown>; submissionId: string }) =>
    submitOrQueue(input),
}));

let useDeliveryActions: typeof import("@/features/deliveries/hooks/use-delivery-actions").useDeliveryActions;

beforeAll(async () => {
  ({ useDeliveryActions } = await import(
    "@/features/deliveries/hooks/use-delivery-actions"
  ));
});

const photo = {
  uri: "file:///canhoto.jpg",
  fileName: "canhoto.jpg",
  fileSize: 1024,
  mimeType: "image/jpeg",
};

const never = (): Promise<Fix> => new Promise(() => undefined);

beforeEach(() => {
  submitOrQueue.mockClear();
  toasts.length = 0;
  cachedList = undefined;

  gps.permission = "granted";
  gps.current = () =>
    Promise.resolve({ coords: { latitude: -23.55, longitude: -46.63 } });
  gps.lastKnown = () => Promise.resolve(null);
});

afterEach(() => {
  vi.useRealTimers();
});

const lastBody = () => submitOrQueue.mock.calls.at(-1)![0].body;

describe("a GPS that does not answer (MOB-13)", () => {
  it("an arrival falls back to the last known position instead of spinning", async () => {
    vi.useFakeTimers();

    gps.current = never;
    // Dated like every position expo-location returns: an undated one has
    // no age to check and is refused (capture-location `standsIn`).
    gps.lastKnown = () =>
      Promise.resolve({
        coords: { latitude: -22.9, longitude: -43.2 },
        timestamp: Date.now() - 60_000,
      });

    const arrival = useDeliveryActions("business-1").registerArrival(
      "delivery-1",
      "Maria",
    );

    await vi.advanceTimersByTimeAsync(8_000);

    await expect(arrival).resolves.toBe(true);
    expect(lastBody()).toMatchObject({ latitude: -22.9, longitude: -43.2 });
  });

  it("with no position at all, the arrival says why and queues nothing", async () => {
    vi.useFakeTimers();

    gps.current = never;

    const arrival = useDeliveryActions("business-1").registerArrival(
      "delivery-1",
      "Maria",
    );

    await vi.advanceTimersByTimeAsync(8_000);

    await expect(arrival).resolves.toBe(false);
    expect(submitOrQueue).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toMatchObject({
      type: "error",
      text1: "Não foi possível registrar a chegada.",
    });
    expect(toasts.at(-1)?.text2).toContain("localização");
  });

  it("an arrival with the permission refused says so, and queues nothing", async () => {
    gps.permission = "denied";

    await expect(
      useDeliveryActions("business-1").registerArrival("delivery-1", "Maria"),
    ).resolves.toBe(false);

    expect(submitOrQueue).not.toHaveBeenCalled();
    expect(toasts.at(-1)?.text2).toBe(
      "Ative a permissão de localização para registrar a chegada.",
    );
  });

  it("a proof goes on without coordinates after its short budget", async () => {
    vi.useFakeTimers();

    gps.current = never;

    const proof = useDeliveryActions("business-1").submitProof({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      photo,
    });

    await vi.advanceTimersByTimeAsync(4_000);

    await expect(proof).resolves.toBe(true);
    expect(lastBody()).not.toHaveProperty("latitude");
  });
});

describe("what enters the queue (DLV-ST-2, DLVP-OCC-2)", () => {
  it("'Quem recebeu' goes out normalized, never with a double space", async () => {
    await useDeliveryActions("business-1").submitProof({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      photo,
      receivedBy: "  João   da  Silva ",
    });

    expect(lastBody().received_by).toBe("João da Silva");
  });

  it("an empty 'Quem recebeu' is left out, as before", async () => {
    await useDeliveryActions("business-1").submitProof({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      photo,
      receivedBy: "   ",
    });

    expect(lastBody()).not.toHaveProperty("received_by");
  });

  it("a name the API would refuse never reaches the queue", async () => {
    const done = await useDeliveryActions("business-1").submitProof({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      photo,
      receivedBy: "a".repeat(151),
    });

    expect(done).toBe(false);
    expect(submitOrQueue).not.toHaveBeenCalled();
    expect(toasts.at(-1)).toMatchObject({
      type: "error",
      text1: "Não foi possível comprovar a entrega.",
      text2: "O nome de quem recebeu deve ter no máximo 150 caracteres.",
    });
  });

  it("the description keeps its paragraphs and loses its double spaces", async () => {
    await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-1",
      description: " Portão  fechado.\n\nVizinho   informou. ",
    });

    expect(lastBody().description).toBe(
      "Portão fechado.\n\nVizinho informou.",
    );
  });

  it("a description the API would refuse never reaches the queue", async () => {
    const done = await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-1",
      description: "a".repeat(501),
    });

    expect(done).toBe(false);
    expect(submitOrQueue).not.toHaveBeenCalled();
  });

  it("the draft's submission id is the one the API dedupes on", async () => {
    const draftId = "7d1f2a4e-3b5c-4d6e-8f90-1a2b3c4d5e6f";

    await useDeliveryActions("business-1").submitProof({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      photo,
      submissionId: draftId,
    });

    expect(submitOrQueue.mock.calls[0][0].submissionId).toBe(draftId);
    expect(lastBody().client_submission_id).toBe(draftId);
  });
});

describe("the departure and the arrival", () => {
  it("starts the route the driver pressed (MOB-04)", async () => {
    await useDeliveryActions("business-1").startRoute({
      routeId: "route-new",
      routeCode: 42,
      count: 3,
    });

    expect(submitOrQueue.mock.calls[0][0].endpoint).toBe(
      "/route/start-route/route-new/business/business-1",
    );
  });

  it("marks the cached stop ARRIVED as soon as the arrival is recorded (MOB-19)", async () => {
    cachedList = {
      data: [
        {
          id: "delivery-1",
          status: "IN_TRANSIT",
          stops: [
            {
              id: "stop-1",
              sequence: 10,
              status: "PENDING",
              route: { id: "r-1", code: 1, name: null, status: "IN_PROGRESS" },
            },
          ],
        },
      ],
      occurrence_types: [],
    };

    await useDeliveryActions("business-1").registerArrival("delivery-1", "Maria");

    const stop = (cachedList as { data: Array<{ stops: Array<{ status: string; arrived_at: string }> }> })
      .data[0].stops[0];

    expect(stop.status).toBe("ARRIVED");
    expect(stop.arrived_at).toBe(lastBody().occurred_at);
  });
});
