import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";
import {
  resolvePause,
  shouldAdoptServer,
  type LocalPauseState,
  type OpenPause,
  type ServerPauseSnapshot,
} from "@/features/pauses/pause-rules";

/**
 * The queue's runner for the pause gestures and "Estou a caminho"
 * (decisions 6.1 and 6.4; docs/contratos-app/pauses.md and on-the-way.md).
 *
 * The real `outbox.ts` runs over an in-memory disk and a fake API, like
 * outbox-runner.test.ts. What is pinned is each contract's error table: which
 * refusals end an item as done (nothing to show the driver), which ones the
 * order of the queue will fix (retried, not failed), and which ones stay a
 * visible failure.
 */

// ---------------------------------------------------------------- natives
const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

vi.mock("expo-file-system", () => {
  class Directory {
    exists = false;
    create() {}
    delete() {}
  }

  return { Directory, File: class {}, Paths: { document: "doc" } };
});

vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));

const invalidated: unknown[][] = [];

// A reread that never answers stands for a weak link's whole timeout.
let rereadHangs = false;

vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
      invalidated.push(queryKey);

      return rereadHangs ? new Promise(() => undefined) : Promise.resolve();
    },
    setQueryData: () => undefined,
  },
}));

vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: class UploadError extends Error {},
  uploadToStorage: async () => [],
}));

type Sent = {
  endpoint: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

const sent: Sent[] = [];
const request = vi.fn();

vi.mock("@/utils/api", async () => {
  const { ApiError: RealApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>(
      "@/utils/api-error",
    );

  return {
    ApiError: RealApiError,
    apiClient: {
      request: async (
        endpoint: string,
        config: { body: Record<string, unknown>; headers: Record<string, string> },
      ) => {
        sent.push({ endpoint, body: config.body, headers: config.headers });

        return request(endpoint, config);
      },
    },
  };
});

const STORAGE_KEY = "@trajetto:outbox:v1";

let outbox: typeof import("@/features/submissions/outbox");
let pauses: typeof import("@/features/pauses/pause-store");
let marks: typeof import("@/features/deliveries/on-the-way-store");
let effects: typeof import("@/features/submissions/kind-effects");
let outboxStore: typeof import("@/store/outbox-store");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
  pauses = await import("@/features/pauses/pause-store");
  marks = await import("@/features/deliveries/on-the-way-store");
  effects = await import("@/features/submissions/kind-effects");
  outboxStore = await import("@/store/outbox-store");
});

const START_A = "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01";
const END_A = "1c4d7d1f-9a8b-4b62-8e8f-3a2d6c9b0f12";
const START_B = "2d5e8e2a-0b9c-4c73-9f90-4b3e7d0c1a23";

const SCOPE = "user-a:business-1";

function item(id: string, kind: string, endpoint: string, body: Record<string, unknown>) {
  return {
    id,
    kind,
    businessId: "business-1",
    ownerUserId: "user-a",
    endpoint,
    body,
    photos: [],
    uploadType: "deliveryPhotos",
    photoField: "photo",
    createdAt: new Date(0).toISOString(),
    attempts: 0,
    nextAttemptAt: 0,
    status: "pending",
  };
}

const startItem = (key: string) =>
  item(key, "delivery-pause-start", "/driver-pause/start/business-1", {
    kind: "MEAL",
    start_submission_id: key,
    occurred_at: "2026-09-29T15:00:00.000Z",
  });

const endItem = (startKey: string, endKey: string) =>
  item(endKey, "delivery-pause-end", "/driver-pause/end/business-1", {
    start_submission_id: startKey,
    end_submission_id: endKey,
    occurred_at: "2026-09-29T16:00:00.000Z",
    start: { kind: "MEAL", occurred_at: "2026-09-29T15:00:00.000Z" },
  });

const onTheWayItem = (id: string, stopId = "stop-1", routeId = "route-1") =>
  item(
    id,
    "delivery-on-the-way",
    `/route/on-the-way/${stopId}/route/${routeId}/business/business-1`,
    { client_submission_id: id, occurred_at: "2026-09-29T15:02:00.000Z" },
  );

const refusal = (code: string, status = 409) =>
  new ApiError("Recusado.", status, "Conflict", "HTTP", code);

const networkDown = () =>
  new ApiError("Network request failed", 0, "Network Error", "NETWORK");

function onDisk(): Array<Record<string, unknown>> {
  return JSON.parse(disk.get(STORAGE_KEY) ?? "[]");
}

function queue(...items: Array<Record<string, unknown>>) {
  disk.set(STORAGE_KEY, JSON.stringify(items));
}

/** Answers by endpoint prefix, in order, so a test reads like the contract. */
function answer(byEndpoint: Array<[string, () => unknown]>) {
  request.mockImplementation(async (endpoint: string) => {
    const index = byEndpoint.findIndex(([prefix]) => endpoint.startsWith(prefix));
    if (index === -1) throw new Error(`unexpected request ${endpoint}`);

    const [, reply] = byEndpoint.splice(index, 1)[0];
    return reply();
  });
}

const fail = (error: Error) => () => {
  throw error;
};

beforeEach(async () => {
  disk.clear();
  sent.length = 0;
  invalidated.length = 0;
  rereadHangs = false;
  request.mockReset();
  vi.restoreAllMocks();

  setSubmissionOwner("user-a");

  await pauses.hydratePauseStore();
  await marks.hydrateOnTheWayStore();
  pauses.usePauseStore.setState({ byScope: {}, sending: {} });
  marks.useOnTheWayStore.setState({ byScope: {} });
});

describe("a pause start", () => {
  it("goes with its key in the body and the header, and the screen rereads the server", async () => {
    queue(startItem(START_A));
    answer([["/driver-pause/start/", () => ({ pause: {}, replayed: false })]]);

    await outbox.processOutbox();

    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe("/driver-pause/start/business-1");
    expect(sent[0].body.start_submission_id).toBe(START_A);
    expect(sent[0].headers["Idempotency-Key"]).toBe(START_A);
    expect(sent[0].headers["X-Client-Sent-At"]).toEqual(expect.any(String));

    expect(onDisk()).toEqual([]);

    // The pause state, not the 7-day deliveries payload: a pause changes
    // nothing in that list.
    expect(invalidated).toContainEqual(["driver-pause", "business-1"]);
    expect(invalidated).not.toContainEqual(["my-deliveries", "business-1"]);
  });

  it("refused as too old: dropped without a failure, and the phone stops showing it", async () => {
    pauses.usePauseStore.getState().setOpen(SCOPE, {
      startSubmissionId: START_A,
      kind: "MEAL",
      startedAt: "2026-09-20T15:00:00.000Z",
      note: null,
      latitude: null,
      longitude: null,
    });

    queue(startItem(START_A));
    answer([["/driver-pause/start/", fail(refusal("PAUSE_TOO_OLD"))]]);

    await outbox.processOutbox();

    expect(onDisk()).toEqual([]);
    expect(pauses.usePauseStore.getState().byScope[SCOPE].open).toBeNull();
    expect(invalidated).toContainEqual(["driver-pause", "business-1"]);
  });

  it("refused outside a journey (decision 14.4): dropped without a failure, forgotten, and the screen told", async () => {
    const { onPauseRequiresRoute } = await import("@/features/pauses/pause-notices");
    const told = vi.fn();
    const stop = onPauseRequiresRoute(told);

    pauses.usePauseStore.getState().setOpen(SCOPE, {
      startSubmissionId: START_A,
      kind: "MEAL",
      startedAt: "2026-09-29T15:00:00.000Z",
      note: null,
      latitude: null,
      longitude: null,
    });

    queue(startItem(START_A));
    answer([["/driver-pause/start/", fail(refusal("PAUSE_REQUIRES_ROUTE", 409))]]);

    try {
      await outbox.processOutbox();
    } finally {
      stop();
    }

    expect(onDisk()).toEqual([]);
    expect(pauses.usePauseStore.getState().byScope[SCOPE].open).toBeNull();
    expect(invalidated).toContainEqual(["driver-pause", "business-1"]);
    expect(told).toHaveBeenCalledTimes(1);
  });

  it("refused as already open while its own end is queued: the start is dropped, the end creates the pause", async () => {
    queue(startItem(START_A), endItem(START_A, END_A));
    answer([
      ["/driver-pause/start/", fail(refusal("PAUSE_ALREADY_OPEN"))],
      ["/driver-pause/end/", () => ({ pause: {}, replayed: false })],
    ]);

    await outbox.processOutbox();

    expect(sent.map((attempt) => attempt.endpoint)).toEqual([
      "/driver-pause/start/business-1",
      "/driver-pause/end/business-1",
    ]);

    // The end carried `start`: nothing of the pause is lost, and no red card.
    expect(sent[1].body.start).toMatchObject({ kind: "MEAL" });
    expect(onDisk()).toEqual([]);
  });

  it("refused as already open behind another pause's end that did not land: retried, never failed", async () => {
    queue(endItem(START_A, END_A), startItem(START_B));
    answer([
      ["/driver-pause/end/", fail(networkDown())],
      ["/driver-pause/start/", fail(refusal("PAUSE_ALREADY_OPEN"))],
    ]);

    await outbox.processOutbox();

    const [end, start] = onDisk();
    expect(end).toMatchObject({ id: END_A, status: "pending", attempts: 1 });
    expect(start).toMatchObject({ id: START_B, status: "pending", attempts: 1 });
    expect(start.failure).toBeUndefined();

    // Later, in order: the old pause ends, then the new one starts.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60 * 60_000);
    answer([
      ["/driver-pause/end/", () => ({ pause: {}, replayed: false })],
      ["/driver-pause/start/", () => ({ pause: {}, replayed: false })],
    ]);

    await outbox.processOutbox();

    expect(onDisk()).toEqual([]);
  });

  it("refused as already open with nothing of its own queued: the server's pause is the one shown", async () => {
    pauses.usePauseStore.getState().setOpen(SCOPE, {
      startSubmissionId: START_B,
      kind: "REST",
      startedAt: "2026-09-29T15:00:00.000Z",
      note: null,
      latitude: null,
      longitude: null,
    });

    queue(startItem(START_B));
    answer([["/driver-pause/start/", fail(refusal("PAUSE_ALREADY_OPEN"))]]);

    await outbox.processOutbox();

    expect(onDisk()).toEqual([]);
    expect(pauses.usePauseStore.getState().byScope[SCOPE].open).toBeNull();
    expect(invalidated).toContainEqual(["driver-pause", "business-1"]);
  });

  it("a late verdict about an old start never takes away a newer pause", async () => {
    pauses.usePauseStore.getState().setOpen(SCOPE, {
      startSubmissionId: START_B,
      kind: "REST",
      startedAt: "2026-09-29T15:00:00.000Z",
      note: null,
      latitude: null,
      longitude: null,
    });

    queue(startItem(START_A));
    answer([["/driver-pause/start/", fail(refusal("PAUSE_TOO_OLD"))]]);

    await outbox.processOutbox();

    expect(pauses.usePauseStore.getState().byScope[SCOPE].open?.startSubmissionId).toBe(
      START_B,
    );
  });

  it("goes to the Entregas module's parking when the module is off", async () => {
    queue(startItem(START_A));
    answer([["/driver-pause/start/", fail(refusal("MODULE_NOT_ENABLED", 403))]]);

    await outbox.processOutbox();

    expect(onDisk()[0]).toMatchObject({ status: "parked" });
  });
});

describe("a /current answer asked while the gesture was still queued", () => {
  const pauseY: OpenPause = {
    startSubmissionId: START_A,
    kind: "MEAL",
    startedAt: "2026-09-29T15:00:00.000Z",
    note: null,
    latitude: null,
    longitude: null,
  };

  /**
   * The pause record at the instant the item left the queue, as a screen
   * rendering then would read it. Null until the item was seen, then gone.
   */
  function recordWhenGone(id: string) {
    let present = false;
    let seen: LocalPauseState | null | undefined;

    const stop = outboxStore.useOutboxStore.subscribe((state) => {
      const here = state.items.some((queued) => queued.id === id);

      if (here) present = true;
      else if (present && seen === undefined) {
        seen = pauses.usePauseStore.getState().byScope[SCOPE] ?? null;
      }
    });

    return { read: () => seen ?? null, stop };
  }

  /** What the screen shows with that record, the old answer and an empty queue. */
  const screen = (local: LocalPauseState | null, server: ServerPauseSnapshot) => {
    const input = { local, server, queued: [], sending: false };

    return { open: resolvePause(input).open, adopt: shouldAdoptServer(input) };
  };

  it("a start that lands: the pause stays on screen, never adopted as 'no pause'", async () => {
    // Tapped offline; on reconnect /current is asked before the queued start
    // reaches the API, so it says 'no pause'.
    const tappedAt = Date.now() - 10_000;
    pauses.usePauseStore.getState().setOpen(SCOPE, pauseY, tappedAt);
    const snapshot = { open: null, requestedAt: tappedAt + 5_000 };

    queue(startItem(START_A));
    answer([["/driver-pause/start/", () => ({ pause: {}, replayed: false })]]);

    const record = recordWhenGone(START_A);
    await outbox.processOutbox();
    record.stop();

    expect(onDisk()).toEqual([]);
    expect(screen(record.read(), snapshot)).toEqual({ open: pauseY, adopt: false });
  });

  it("an end that lands: the ended pause does not come back running", async () => {
    const tappedAt = Date.now() - 10_000;
    pauses.usePauseStore.getState().setOpen(SCOPE, null, tappedAt);
    const snapshot = { open: pauseY, requestedAt: tappedAt + 5_000 };

    queue(endItem(START_A, END_A));
    answer([["/driver-pause/end/", () => ({ pause: {}, replayed: false })]]);

    const record = recordWhenGone(END_A);
    await outbox.processOutbox();
    record.stop();

    expect(screen(record.read(), snapshot)).toEqual({ open: null, adopt: false });
  });

  it("an end settled as already ended: the old answer does not bring the pause back either", async () => {
    const tappedAt = Date.now() - 10_000;
    pauses.usePauseStore.getState().setOpen(SCOPE, null, tappedAt);
    const snapshot = { open: pauseY, requestedAt: tappedAt + 5_000 };

    queue(endItem(START_A, END_A));
    answer([["/driver-pause/end/", fail(refusal("PAUSE_ALREADY_ENDED"))]]);

    const record = recordWhenGone(END_A);
    await outbox.processOutbox();
    record.stop();

    expect(onDisk()).toEqual([]);
    expect(screen(record.read(), snapshot)).toEqual({ open: null, adopt: false });
  });

  it("the effect of a landed pause gesture never waits for the reread", async () => {
    // At the tap, 'sending' (and the disabled 'Encerrar') lasts as long as
    // this promise: a slow GET must not stretch it.
    rereadHangs = true;
    pauses.usePauseStore.getState().setOpen(SCOPE, pauseY, Date.now() - 1_000);

    const outcome = await Promise.race([
      effects
        .afterSubmissionSent(
          {
            kind: "delivery-pause-start",
            businessId: "business-1",
            ownerUserId: "user-a",
            endpoint: "/driver-pause/start/business-1",
            body: { start_submission_id: START_A },
          },
          { pause: {}, replayed: false },
        )
        .then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 200)),
    ]);

    expect(outcome).toBe("done");
    expect(invalidated).toContainEqual(["driver-pause", "business-1"]);
  });
});

describe("a pause end", () => {
  it("refused as already ended: done", async () => {
    queue(endItem(START_A, END_A));
    answer([["/driver-pause/end/", fail(refusal("PAUSE_ALREADY_ENDED"))]]);

    await outbox.processOutbox();

    expect(onDisk()).toEqual([]);
    expect(invalidated).toContainEqual(["driver-pause", "business-1"]);
  });

  it("refused as too old: dropped without a failure", async () => {
    queue(endItem(START_A, END_A));
    answer([["/driver-pause/end/", fail(refusal("PAUSE_TOO_OLD"))]]);

    await outbox.processOutbox();

    expect(onDisk()).toEqual([]);
  });

  it("refused for a reused key: a visible failure, as the contract says", async () => {
    queue(endItem(START_A, END_A));
    answer([["/driver-pause/end/", fail(refusal("PAUSE_SUBMISSION_REUSED"))]]);

    await outbox.processOutbox();

    expect(onDisk()[0]).toMatchObject({ status: "failed", failure: "permanent" });
  });
});

describe("'Estou a caminho'", () => {
  it("keeps the instant the API recorded once it lands", async () => {
    queue(onTheWayItem(START_A));
    answer([
      [
        "/route/on-the-way/",
        () => ({
          message: "Parada marcada como a caminho.",
          data: {
            stopId: "stop-1",
            routeId: "route-1",
            deliveryId: "delivery-1",
            on_the_way_at: "2026-09-29T15:02:07.000Z",
          },
        }),
      ],
    ]);

    await outbox.processOutbox();

    expect(sent[0].headers["Idempotency-Key"]).toBe(START_A);
    expect(sent[0].body.client_submission_id).toBe(START_A);
    expect(onDisk()).toEqual([]);

    expect(marks.useOnTheWayStore.getState().byScope[SCOPE]["stop-1"]).toMatchObject({
      routeId: "route-1",
      at: "2026-09-29T15:02:07.000Z",

      // The tap by the phone's clock, next to the API's: the clock error.
      tappedAt: "2026-09-29T15:02:00.000Z",
    });
  });

  it("refused because the stop moved on: dropped without a failure, the list rereads", async () => {
    queue(onTheWayItem(START_A));
    answer([["/route/on-the-way/", fail(refusal("ROUTE_STOP_NOT_PENDING"))]]);

    await outbox.processOutbox();

    expect(onDisk()).toEqual([]);
    expect(invalidated).toContainEqual(["my-deliveries", "business-1"]);
    expect(marks.useOnTheWayStore.getState().byScope[SCOPE]).toBeUndefined();
  });

  it("refused because the route is not on the street: dropped", async () => {
    queue(onTheWayItem(START_A));
    answer([["/route/on-the-way/", fail(refusal("ROUTE_NOT_IN_PROGRESS"))]]);

    await outbox.processOutbox();

    expect(onDisk()).toEqual([]);
  });

  it("refused because the route has not left while its departure waits ahead in the queue: retried", async () => {
    queue(
      {
        // Tapped just now: a departure older than half a day is expired
        // before it is sent (isSendExpired).
        ...item(END_A, "delivery-start-route", "/route/start-route/route-1/business/business-1", {
          occurred_at: "2026-09-29T15:00:00.000Z",
        }),
        createdAt: new Date().toISOString(),
      },
      onTheWayItem(START_A),
    );
    answer([
      ["/route/start-route/", fail(networkDown())],
      ["/route/on-the-way/", fail(refusal("ROUTE_NOT_IN_PROGRESS"))],
    ]);

    await outbox.processOutbox();

    const [, mark] = onDisk();
    expect(mark).toMatchObject({ id: START_A, status: "pending", attempts: 1 });
  });

  it("refused because the route has not left, with only ANOTHER driver's departure queued: dropped", async () => {
    queue(
      {
        ...item(END_A, "delivery-start-route", "/route/start-route/route-1/business/business-1", {
          occurred_at: "2026-09-29T15:00:00.000Z",
        }),
        // The route was reassigned: the previous driver's departure is still
        // on this phone, and it is never sent under this session.
        ownerUserId: "user-b",
        createdAt: new Date().toISOString(),
      },
      onTheWayItem(START_A),
    );
    answer([["/route/on-the-way/", fail(refusal("ROUTE_NOT_IN_PROGRESS"))]]);

    await outbox.processOutbox();

    expect(sent.map((attempt) => attempt.endpoint)).toEqual([
      "/route/on-the-way/stop-1/route/route-1/business/business-1",
    ]);
    expect(onDisk().map((left) => left.id)).toEqual([END_A]);
  });

  it("refused for a reused key: a visible failure", async () => {
    queue(onTheWayItem(START_A));
    answer([["/route/on-the-way/", fail(refusal("SUBMISSION_ID_REUSED"))]]);

    await outbox.processOutbox();

    expect(onDisk()[0]).toMatchObject({ status: "failed" });
  });
});
