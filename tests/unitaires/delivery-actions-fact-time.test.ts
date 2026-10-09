import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every driver action says when it happened (MOB-08).
 *
 * The body is what the outbox freezes and sends — possibly hours later, from
 * a basement or a stretch of road with no signal. Without the instant of the
 * tap in it, the API could only stamp the instant the signal came back: a
 * receipt signed at 10:05 became "entregue às 13:40" for the customer, the
 * stop and the SLA. The instant is read when the driver acts, not when the
 * request leaves.
 */

// A hook outside React: state is inert here, the actions are what is tested.
vi.mock("react", () => ({
  useState: <T,>(initial: T) => [initial, () => undefined],
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

const submitOrQueue = vi.fn(
  async (_input: { endpoint: string; body: Record<string, unknown> }) =>
    "queued" as const,
);

vi.mock("@/features/submissions/submit-or-queue", () => ({
  submitOrQueue: (input: { endpoint: string; body: Record<string, unknown> }) =>
    submitOrQueue(input),
}));

let useDeliveryActions: typeof import("@/features/deliveries/hooks/use-delivery-actions").useDeliveryActions;

beforeAll(async () => {
  ({ useDeliveryActions } = await import(
    "@/features/deliveries/hooks/use-delivery-actions"
  ));
});

const TAP = new Date("2026-09-24T10:05:00.000Z");

const photo = {
  uri: "file:///canhoto.jpg",
  fileName: "canhoto.jpg",
  fileSize: 1024,
  mimeType: "image/jpeg",
};

beforeEach(() => {
  submitOrQueue.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TAP);
});

afterEach(() => {
  vi.useRealTimers();
});

const lastBody = () => submitOrQueue.mock.calls.at(-1)![0].body;

describe("the body of every queued driver action", () => {
  it("a departure through the route", async () => {
    await useDeliveryActions("business-1").startRoute({
      routeId: "route-1",
      routeCode: 1,
      count: 2,
    });

    expect(submitOrQueue.mock.calls[0][0].endpoint).toBe(
      "/route/start-route/route-1/business/business-1",
    );
    expect(lastBody().occurred_at).toBe(TAP.toISOString());
  });

  it("a departure through the legacy endpoint", async () => {
    await useDeliveryActions("business-1").startRoute({
      routeId: null,
      routeCode: null,
      count: 1,
    });

    expect(submitOrQueue.mock.calls[0][0].endpoint).toBe(
      "/delivery/start-route/business-1",
    );
    expect(lastBody().occurred_at).toBe(TAP.toISOString());
  });

  it("an arrival", async () => {
    await useDeliveryActions("business-1").registerArrival("delivery-1", "Maria");

    expect(lastBody()).toMatchObject({
      client_submission_id: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
      occurred_at: TAP.toISOString(),
    });
  });

  it("a proof", async () => {
    await useDeliveryActions("business-1").submitProof({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      photo,
    });

    expect(lastBody().occurred_at).toBe(TAP.toISOString());
  });

  it("an occurrence", async () => {
    await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-1",
    });

    expect(lastBody().occurred_at).toBe(TAP.toISOString());
  });
});
