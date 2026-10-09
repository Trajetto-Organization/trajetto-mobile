import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";

/**
 * "Estou a caminho", driven for real — its body, its key, what it keeps from
 * the API's answer — with the network edge (`submitOrQueue`) and the natives
 * replaced (decision 6.4; docs/contratos-app/on-the-way.md).
 */

const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

const KEY = "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01";

vi.mock("expo-crypto", () => ({ randomUUID: () => KEY }));

let position: { latitude: number; longitude: number } | null = null;

vi.mock("@/features/tracking/capture-location", () => ({
  captureLocation: async () => position,
}));

const invalidated: unknown[][] = [];

vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    invalidateQueries: async ({ queryKey }: { queryKey: unknown[] }) => {
      invalidated.push(queryKey);
    },
  },
}));

vi.mock("@/utils/api", async () => {
  const { ApiError: RealApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>("@/utils/api-error");

  return { ApiError: RealApiError, apiClient: { request: async () => ({}) } };
});

type Submitted = {
  submissionId: string;
  kind: string;
  endpoint: string;
  body: Record<string, unknown>;
  onSent?: (response: unknown) => void | Promise<void>;
};

const submitOrQueue = vi.fn<[Submitted], Promise<string>>();

vi.mock("@/features/submissions/submit-or-queue", () => ({
  submitOrQueue: (input: Submitted) => submitOrQueue(input),
}));

let actions: typeof import("@/features/deliveries/on-the-way-actions");
let marks: typeof import("@/features/deliveries/on-the-way-store");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  actions = await import("@/features/deliveries/on-the-way-actions");
  marks = await import("@/features/deliveries/on-the-way-store");
});

const context = { userId: "user-a", businessId: "business-1" };
const target = {
  deliveryId: "delivery-1",
  stopId: "stop-1",
  routeId: "route-1",
  recipientName: "Maria",
};

beforeEach(async () => {
  disk.clear();
  invalidated.length = 0;
  position = null;
  submitOrQueue.mockReset();

  await marks.hydrateOnTheWayStore();
  marks.useOnTheWayStore.setState({ byScope: {} });
});

describe("one tap on 'Estou a caminho'", () => {
  it("names the stop and the route, with one key and the instant of the tap", async () => {
    submitOrQueue.mockResolvedValue("queued");

    const before = Date.now();
    const result = await actions.markStopOnTheWay(context, target);

    expect(result).toEqual({ status: "queued" });

    const [{ submissionId, kind, endpoint, body }] = submitOrQueue.mock.calls[0];

    expect(submissionId).toBe(KEY);
    expect(kind).toBe("delivery-on-the-way");
    expect(endpoint).toBe("/route/on-the-way/stop-1/route/route-1/business/business-1");
    expect(body.client_submission_id).toBe(KEY);
    expect(Date.parse(String(body.occurred_at))).toBeGreaterThanOrEqual(before - 1);

    // No fix: still marked, without a position (never half a pair).
    expect(body).not.toHaveProperty("latitude");
    expect(body).not.toHaveProperty("longitude");
  });

  it("sends the position as a pair when the phone has one", async () => {
    position = { latitude: -15.6, longitude: -56.1 };
    submitOrQueue.mockResolvedValue("queued");

    await actions.markStopOnTheWay(context, target);

    expect(submitOrQueue.mock.calls[0][0].body).toMatchObject({ latitude: -15.6, longitude: -56.1 });
  });

  it("sent at once: the phone keeps the instant the API recorded", async () => {
    submitOrQueue.mockImplementation(async (input) => {
      await input.onSent?.({
        message: "Parada marcada como a caminho.",
        data: {
          stopId: "stop-1",
          routeId: "route-1",
          deliveryId: "delivery-1",
          on_the_way_at: "2026-09-29T15:02:07.000Z",
        },
      });

      return "sent";
    });

    expect(await actions.markStopOnTheWay(context, target)).toEqual({ status: "sent" });

    expect(marks.useOnTheWayStore.getState().byScope["user-a:business-1"]["stop-1"]).toMatchObject({
      routeId: "route-1",
      at: "2026-09-29T15:02:07.000Z",
    });
  });

  it("the stop already moved on: moot, not a failure, and the list rereads", async () => {
    submitOrQueue.mockRejectedValue(
      new ApiError("Esta parada não está mais pendente.", 409, "Conflict", "HTTP", "ROUTE_STOP_NOT_PENDING"),
    );

    expect(await actions.markStopOnTheWay(context, target)).toEqual({
      status: "moot",
      message: "Esta parada não está mais pendente.",
    });
    expect(invalidated).toContainEqual(["my-deliveries", "business-1"]);
  });

  it("any other refusal is said as it came", async () => {
    submitOrQueue.mockRejectedValue(
      new ApiError("Sem permissão.", 403, "Forbidden", "HTTP", "PERMISSION_DENIED"),
    );

    expect(await actions.markStopOnTheWay(context, target)).toEqual({
      status: "refused",
      message: "Sem permissão.",
    });
  });
});
