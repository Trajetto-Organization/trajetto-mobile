import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { resolvePause, type ServerPauseSnapshot } from "@/features/pauses/pause-rules";

/**
 * The two pause gestures, driven for real — their record on the phone, their
 * bodies, their choice between sending and queueing — with the network edge
 * (`submitOrQueue`, the queue) and the natives replaced.
 *
 * What is pinned is the contract's promise to the driver (decision 6.1):
 * the pause is on screen from the tap, with or without signal; the gestures
 * go in the order they were tapped; one pause at a time; a refusal at the tap
 * takes back what the phone recorded.
 */

const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

const KEYS = [
  "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
  "1c4d7d1f-9a8b-4b62-8e8f-3a2d6c9b0f12",
  "2d5e8e2a-0b9c-4c73-9f90-4b3e7d0c1a23",
  "3e6f9f3b-1cad-4d84-a0a1-5c4f8e1d2b34",
];
let nextKey = 0;

vi.mock("expo-crypto", () => ({ randomUUID: () => KEYS[nextKey++ % KEYS.length] }));

let position: { latitude: number; longitude: number } | null = null;

// Set to hold the GPS: the window in which a killed app used to lose the tap.
let locating: Promise<{ latitude: number; longitude: number } | null> | null = null;

vi.mock("@/features/tracking/capture-location", () => ({
  captureLocation: () => locating ?? Promise.resolve(position),
}));

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries: async () => undefined },
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

// Publishes what it holds like the real queue, so the next gesture reads it
// (and, after a "kill", the fresh process's store is the one written).
const enqueueSubmission = vi.fn(async (input: Record<string, unknown>) => {
  const { useOutboxStore } = await import("@/store/outbox-store");
  const others = useOutboxStore.getState().items.filter((queued) => queued.id !== input.id);

  useOutboxStore.setState({
    items: [
      ...others,
      {
        ...input,
        status: "pending",
        attempts: 0,
        nextAttemptAt: 0,
        createdAt: new Date().toISOString(),
      } as unknown as (typeof others)[number],
    ],
  });
});
const processOutbox = vi.fn(async () => undefined);

vi.mock("@/features/submissions/outbox", () => ({
  enqueueSubmission: (input: Record<string, unknown>) => enqueueSubmission(input),
  processOutbox: () => processOutbox(),
}));

let actions: typeof import("@/features/pauses/pause-actions");
let store: typeof import("@/features/pauses/pause-store");
let outboxStore: typeof import("@/store/outbox-store");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  actions = await import("@/features/pauses/pause-actions");
  store = await import("@/features/pauses/pause-store");
  outboxStore = await import("@/store/outbox-store");
});

const context = { userId: "user-a", businessId: "business-1" };
const SCOPE = "user-a:business-1";

const openPause = () => store.usePauseStore.getState().byScope[SCOPE]?.open ?? null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  disk.clear();
  nextKey = 0;
  position = null;
  locating = null;
  submitOrQueue.mockReset();
  enqueueSubmission.mockClear();
  processOutbox.mockClear();

  await store.hydratePauseStore();
  store.usePauseStore.setState({ byScope: {}, handoffs: {}, sending: {} });
  outboxStore.useOutboxStore.setState({ items: [] });
});

describe("starting a pause", () => {
  it("is on the phone BEFORE it is sent: the timer runs even if the app dies mid-send", async () => {
    let recordedAtSend: unknown = "not called";

    submitOrQueue.mockImplementation(async () => {
      recordedAtSend = openPause();
      return "queued";
    });

    const result = await actions.startDriverPause(context, { kind: "MEAL", note: " Almoço  no posto " });

    expect(recordedAtSend).toMatchObject({ startSubmissionId: KEYS[0], kind: "MEAL" });
    expect(result).toMatchObject({ status: "queued" });

    // And on disk, where a cold start reads it.
    expect(disk.get("@trajetto:driver-pause:v1")).toContain(KEYS[0]);

    const [{ submissionId, kind, endpoint, body }] = submitOrQueue.mock.calls[0];
    expect(submissionId).toBe(KEYS[0]);
    expect(kind).toBe("delivery-pause-start");
    expect(endpoint).toBe("/driver-pause/start/business-1");
    expect(body).toMatchObject({
      kind: "MEAL",
      start_submission_id: KEYS[0],
      note: "Almoço no posto",
      occurred_at: expect.any(String),
    });
  });

  it("carries the position when the phone has one, and repeats it on the record for the end", async () => {
    position = { latitude: -23.55, longitude: -46.63 };
    submitOrQueue.mockResolvedValue("sent");

    await actions.startDriverPause(context, { kind: "REST" });

    expect(submitOrQueue.mock.calls[0][0].body).toMatchObject({ latitude: -23.55, longitude: -46.63 });
    expect(openPause()).toMatchObject({ latitude: -23.55, longitude: -46.63 });
  });

  it("goes behind the pause gestures still queued, in the order they were tapped", async () => {
    outboxStore.useOutboxStore.setState({
      items: [
        {
          id: "end-old",
          kind: "delivery-pause-end",
          businessId: "business-1",
          ownerUserId: "user-a",
          endpoint: "/driver-pause/end/business-1",
          body: { start_submission_id: "start-old", end_submission_id: "end-old" },
          photos: [],
          uploadType: "deliveryPhotos",
          photoField: "photo",
          createdAt: "2026-09-29T15:00:00.000Z",
          attempts: 1,
          nextAttemptAt: 0,
          status: "pending",
        },
      ],
    });

    const result = await actions.startDriverPause(context, { kind: "MEAL" });

    // Queued for the order, not for a connection: the toast says so.
    expect(result).toMatchObject({ status: "queued-behind" });
    expect(submitOrQueue).not.toHaveBeenCalled();
    expect(enqueueSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        id: KEYS[0],
        kind: "delivery-pause-start",
        ownerUserId: "user-a",
        endpoint: "/driver-pause/start/business-1",
      }),
    );
    expect(processOutbox).toHaveBeenCalled();
  });

  it("refused at the tap because another pause is open: nothing stays on the phone", async () => {
    submitOrQueue.mockRejectedValue(
      new ApiError("Já existe uma pausa em andamento.", 409, "Conflict", "HTTP", "PAUSE_ALREADY_OPEN"),
    );

    const result = await actions.startDriverPause(context, { kind: "MEAL" });

    expect(result).toEqual({ status: "already-open" });
    expect(openPause()).toBeNull();
  });

  it("refused at the tap for any other reason: nothing stays on the phone, the reason is said", async () => {
    submitOrQueue.mockRejectedValue(
      new ApiError("Sem permissão.", 403, "Forbidden", "HTTP", "PERMISSION_DENIED"),
    );

    const result = await actions.startDriverPause(context, { kind: "MEAL" });

    expect(result).toEqual({ status: "refused", message: "Sem permissão." });
    expect(openPause()).toBeNull();

    // Nothing left to hand over either: a later start must not queue it.
    expect(store.usePauseStore.getState().handoffs).toEqual({});
  });

  it("sent at the tap: an answer asked before it landed never takes the pause away", async () => {
    let snapshot: ServerPauseSnapshot | null = null;

    submitOrQueue.mockImplementation(async (input: Submitted) => {
      await sleep(5);

      // /current, asked while the start is on its way: no pause yet.
      snapshot = { open: null, requestedAt: Date.now() };

      await sleep(5);
      await input.onSent?.({ pause: {}, replayed: false });

      return "sent";
    });

    await actions.startDriverPause(context, { kind: "MEAL" });

    const local = store.usePauseStore.getState().byScope[SCOPE] ?? null;

    expect(
      resolvePause({ local, server: snapshot, queued: [], sending: false }).open,
    ).toMatchObject({ startSubmissionId: KEYS[0] });
  });

  it("a note the API would refuse never records a pause, never reaches the queue", async () => {
    const result = await actions.startDriverPause(context, { kind: "MEAL", note: "a".repeat(201) });

    expect(result).toMatchObject({ status: "refused" });
    expect(openPause()).toBeNull();
    expect(submitOrQueue).not.toHaveBeenCalled();
  });

  it("a second tap while the first is on its way does nothing: one pause", async () => {
    let release: (value: string) => void = () => undefined;
    submitOrQueue.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const first = actions.startDriverPause(context, { kind: "MEAL" });
    await vi.waitFor(() => expect(submitOrQueue).toHaveBeenCalledTimes(1));

    const second = await actions.startDriverPause(context, { kind: "REST" });

    release("sent");
    await first;

    expect(second).toEqual({ status: "busy" });
    expect(submitOrQueue).toHaveBeenCalledTimes(1);
    expect(openPause()).toMatchObject({ kind: "MEAL" });
  });
});

describe("an app killed between the tap and the queue", () => {
  const PAUSE_KEY = "@trajetto:driver-pause:v1";

  it("loses nothing: the next gesture queues the one left mid-handoff, in tap order", async () => {
    // The GPS never answers, and the process dies waiting for it: nothing
    // had been sent or queued yet.
    locating = new Promise(() => undefined);
    void actions.startDriverPause(context, { kind: "MEAL" });
    await vi.waitFor(() => expect(disk.get(PAUSE_KEY)).toContain("/driver-pause/start/"));

    // A fresh process reads the same disk.
    locating = null;
    vi.resetModules();

    const fresh = await import("@/features/pauses/pause-actions");
    const freshStore = await import("@/features/pauses/pause-store");
    await freshStore.hydratePauseStore();

    const shown = freshStore.usePauseStore.getState().byScope[SCOPE]?.open ?? null;
    expect(shown).toMatchObject({ startSubmissionId: KEYS[0], kind: "MEAL" });

    // The driver ends the pause the screen shows.
    const result = await fresh.endDriverPause(context, shown!);

    expect(enqueueSubmission.mock.calls.map(([input]) => [input.kind, input.id])).toEqual([
      ["delivery-pause-start", KEYS[0]],
      ["delivery-pause-end", KEYS[1]],
    ]);
    expect(enqueueSubmission.mock.calls[0][0]).toMatchObject({
      ownerUserId: "user-a",
      endpoint: "/driver-pause/start/business-1",
      body: { kind: "MEAL", start_submission_id: KEYS[0] },
    });
    expect(result).toEqual({ status: "queued-behind" });
    expect(submitOrQueue).not.toHaveBeenCalled();
    expect(freshStore.usePauseStore.getState().handoffs).toEqual({});
  });

  it("recovers a leftover once, and never a gesture this process is still handing over", async () => {
    let releaseLocation: (value: null) => void = () => undefined;
    locating = new Promise((resolve) => (releaseLocation = resolve));
    submitOrQueue.mockResolvedValue("sent");

    const first = actions.startDriverPause(context, { kind: "MEAL" });
    await vi.waitFor(() => expect(store.usePauseStore.getState().handoffs[SCOPE]).toBeDefined());

    await actions.recoverPauseHandoffs("user-a");
    expect(enqueueSubmission).not.toHaveBeenCalled();

    releaseLocation(null);
    await first;

    expect(submitOrQueue).toHaveBeenCalledTimes(1);
    expect(store.usePauseStore.getState().handoffs).toEqual({});
  });
});

describe("ending a pause", () => {
  const pause = {
    startSubmissionId: KEYS[3],
    kind: "MEAL" as const,
    startedAt: "2026-09-29T15:00:00.000Z",
    note: "Almoço",
    latitude: -23.55,
    longitude: -46.63,
  };

  beforeEach(() => {
    store.usePauseStore.getState().setOpen(SCOPE, pause);
  });

  it("leaves the screen at the tap and sends the start along, so it can land first", async () => {
    let recordedAtSend: unknown = "not called";

    submitOrQueue.mockImplementation(async () => {
      recordedAtSend = openPause();
      return "queued";
    });

    const result = await actions.endDriverPause(context, pause);

    expect(result).toEqual({ status: "queued" });
    expect(recordedAtSend).toBeNull();

    const [{ submissionId, kind, endpoint, body }] = submitOrQueue.mock.calls[0];
    expect(submissionId).toBe(KEYS[0]);
    expect(kind).toBe("delivery-pause-end");
    expect(endpoint).toBe("/driver-pause/end/business-1");
    expect(body).toMatchObject({
      start_submission_id: KEYS[3],
      end_submission_id: KEYS[0],
      start: {
        kind: "MEAL",
        occurred_at: "2026-09-29T15:00:00.000Z",
        latitude: -23.55,
        longitude: -46.63,
        note: "Almoço",
      },
    });
  });

  it("already ended elsewhere: done, and the pause stays off the screen", async () => {
    submitOrQueue.mockRejectedValue(
      new ApiError("Esta pausa já foi encerrada.", 409, "Conflict", "HTTP", "PAUSE_ALREADY_ENDED"),
    );

    expect(await actions.endDriverPause(context, pause)).toEqual({ status: "already-ended" });
    expect(openPause()).toBeNull();
  });

  it("refused at the tap for another reason: the pause is back on the screen", async () => {
    submitOrQueue.mockRejectedValue(
      new ApiError("Sem permissão.", 403, "Forbidden", "HTTP", "PERMISSION_DENIED"),
    );

    expect(await actions.endDriverPause(context, pause)).toEqual({
      status: "refused",
      message: "Sem permissão.",
    });
    expect(openPause()).toMatchObject({ startSubmissionId: KEYS[3] });
  });
});
