import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The phone and the photo instant on a proof (proof design §7.2 and §8).
 *
 * `device_id` and `photo_taken_at` go in the body recorded at the tap, not in
 * a header at send time: a proof made offline at 10:05 and sent at 13:40
 * carries the phone and the photo instant of the capture. Both are optional;
 * the API turns an unknown shape into null and never refuses a proof for it.
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

const identity = vi.hoisted(() => ({ value: "23be03c084165505" as string | null }));

vi.mock("@/features/device/device-identity", () => ({
  deviceIdentity: async () => identity.value,
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

// The camera returned 18 seconds before the tap that sends the proof.
const TAKEN = "2026-09-24T10:04:42.000Z";

const photo = {
  uri: "file:///canhoto.jpg",
  fileName: "canhoto.jpg",
  fileSize: 1024,
  mimeType: "image/jpeg",
  takenAt: TAKEN,
};

beforeEach(() => {
  submitOrQueue.mockClear();
  identity.value = "23be03c084165505";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TAP);
});

afterEach(() => {
  vi.useRealTimers();
});

const lastBody = () => submitOrQueue.mock.calls.at(-1)![0].body;

const deliveredType = {
  id: "type-delivered",
  name: "Entrega normal",
  category: "DELIVERED",
  requires_photo: false,
  requires_receipt_photo: true,
  requires_signature: false,
  requires_authorization: false,
  form: null,
  form_version: 1,
} as never;

describe("a proof's body", () => {
  it("carries the phone and the photo instant (legacy proof)", async () => {
    await useDeliveryActions("business-1").submitProof({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      photo,
    });

    expect(lastBody()).toMatchObject({
      occurred_at: TAP.toISOString(),
      photo_taken_at: TAKEN,
      device_id: "23be03c084165505",
    });
  });

  it("carries them on a delivered occurrence (decision 14.3)", async () => {
    await useDeliveryActions("business-1").submitDelivered({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      type: deliveredType,
      receiptPhoto: photo,
      signature: null,
      photos: [],
    });

    expect(lastBody()).toMatchObject({
      photo_taken_at: TAKEN,
      device_id: "23be03c084165505",
    });
  });

  it("leaves them out when unknown — never a reason to hold the proof", async () => {
    identity.value = null;

    await useDeliveryActions("business-1").submitProof({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      photo: { ...photo, takenAt: undefined },
    });

    expect(lastBody()).not.toHaveProperty("device_id");
    expect(lastBody()).not.toHaveProperty("photo_taken_at");
  });
});
