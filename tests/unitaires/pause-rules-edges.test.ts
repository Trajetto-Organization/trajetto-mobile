import { describe, expect, it } from "vitest";

import {
  PAUSE_END_KIND,
  PAUSE_QUEUED_BEHIND_NOTICE,
  PAUSE_REQUIRES_ROUTE_NOTICE,
  PAUSE_START_KIND,
  currentPauseFromResponse,
  formatPauseDuration,
  isPauseAllowed,
  isStartQueued,
  normalizePauseNote,
  openPauseFromQueue,
  openPauseFromServer,
  openPauseTitle,
  pauseChoicesOf,
  pauseRefusalVerdict,
  pauseTitle,
  resolvePause,
  shouldAdoptServer,
  startPauseBody,
  type OpenPause,
} from "@/features/pauses/pause-rules";

/**
 * Edges of the pause rules left alive by the 06/10 mutation run: the
 * company's time zone deciding "today", the queue read back in odd orders,
 * malformed server answers, and exact copy the driver reads.
 */

const item = (over: Record<string, unknown> & { body?: Record<string, unknown> }) => ({
  id: "i1",
  kind: PAUSE_START_KIND as string,
  status: "pending",
  businessId: "b1",
  ownerUserId: "u1",
  createdAt: "2026-10-06T10:00:00.000Z",
  ...over,
  body: { kind: "MEAL", start_submission_id: "k0", ...over.body },
});

const open = (over: Partial<OpenPause> = {}): OpenPause => ({
  startSubmissionId: "k0",
  kind: "MEAL",
  startedAt: "2026-10-06T10:00:00.000Z",
  note: null,
  latitude: null,
  longitude: null,
  ...over,
});

describe("copy", () => {
  it("offers the three fixed natures with their words when the day has no types", () => {
    expect(pauseChoicesOf(null)).toEqual([
      { occurrenceTypeId: null, kind: "MEAL", label: "Refeição", description: "Almoço, jantar ou lanche." },
      { occurrenceTypeId: null, kind: "REST", label: "Descanso", description: "Parada para descansar." },
      { occurrenceTypeId: null, kind: "OTHER", label: "Outra", description: "Qualquer outro motivo." },
    ]);
  });

  it("names each company type's nature", () => {
    expect(
      pauseChoicesOf([
        { id: "t1", name: "Almoço", pause_kind: "MEAL" },
        { id: "t2", name: "Banheiro", pause_kind: "OTHER" },
      ]).map((choice) => choice.description),
    ).toEqual(["Natureza: Refeição", "Natureza: Outra"]);
  });

  it("titles each pause kind", () => {
    expect(pauseTitle("MEAL")).toBe("Pausa para refeição");
    expect(pauseTitle("REST")).toBe("Pausa para descanso");
    expect(pauseTitle("OTHER")).toBe("Pausa");
  });

  it("falls back to the kind's title for a blank type name", () => {
    expect(openPauseTitle({ kind: "REST", typeName: "   " })).toBe("Pausa para descanso");
    expect(openPauseTitle({ kind: "REST", typeName: " Cochilo " })).toBe("Pausa: Cochilo");
  });

  it("keeps the two notices' wording", () => {
    expect(PAUSE_REQUIRES_ROUTE_NOTICE).toBe("Pausas só valem durante uma rota liberada ou em andamento.");
    expect(PAUSE_QUEUED_BEHIND_NOTICE).toBe(
      "Segue logo depois do registro de pausa anterior, que ainda está na fila.",
    );
  });

  it("switches to hours at exactly sixty minutes", () => {
    const start = "2026-10-06T10:00:00.000Z";

    expect(formatPauseDuration(start, Date.parse(start) + 59 * 60_000)).toBe("59 min");
    expect(formatPauseDuration(start, Date.parse(start) + 60 * 60_000)).toBe("1 h 00 min");
  });
});

describe("isPauseAllowed", () => {
  // 20:00 UTC on 06/10 is 17:00 in São Paulo (06/10) and 05:00 in Tokyo (07/10).
  const now = new Date("2026-10-06T20:00:00.000Z");

  it("takes the server's verdict for a zero-padded day key", () => {
    const early = new Date("2026-10-05T15:00:00.000Z");

    expect(isPauseAllowed({ data: [], journey: { pause_allowed: true, day: "2026-10-05" } }, early)).toBe(true);
  });

  it("reads today in the company's own zone", () => {
    expect(
      isPauseAllowed({ data: [], journey: { pause_allowed: true, day: "2026-10-07", time_zone: "Asia/Tokyo" } }, now),
    ).toBe(true);
  });

  it("falls back to the default zone for an invalid one", () => {
    expect(
      isPauseAllowed({ data: [], journey: { pause_allowed: true, day: "2026-10-06", time_zone: "Not/AZone" } }, now),
    ).toBe(true);
  });

  it("lets the stops decide when the server's verdict is not a boolean", () => {
    const cache = {
      data: [{ stops: [{ route: { status: "IN_PROGRESS" } }] }],
      journey: { day: "2026-10-06" },
    };

    expect(isPauseAllowed(cache, now)).toBe(true);
  });

  it("reads a stop with no route as no journey", () => {
    expect(isPauseAllowed({ data: [{ stops: [{ route: null }] }] }, now)).toBe(false);
  });

  it("only reads a route day written at the start of the value", () => {
    // Unreadable: the benefit of the doubt, the API decides.
    const cache = { data: [{ stops: [{ route: { status: "RELEASED", scheduled_date: "x2026-10-01" } }] }] };

    expect(isPauseAllowed(cache, now)).toBe(true);
  });
});

describe("openPauseFromQueue", () => {
  it("skips a last start without a usable key or kind and finds the earlier one", () => {
    const earlier = item({ id: "a", body: { start_submission_id: "k0" } });

    expect(openPauseFromQueue([earlier, item({ id: "b", body: { start_submission_id: 5 } })])?.startSubmissionId).toBe("k0");
    expect(openPauseFromQueue([earlier, item({ id: "b", body: { start_submission_id: undefined } })])?.startSubmissionId).toBe("k0");
    expect(openPauseFromQueue([earlier, item({ id: "b", body: { start_submission_id: "k1", kind: "NAP" } })])?.startSubmissionId).toBe("k0");
    expect(openPauseFromQueue([earlier, item({ id: "b", kind: "delivery-arrival" })])?.startSubmissionId).toBe("k0");
  });

  it("is closed when the last gesture is an end, even of another pause", () => {
    expect(
      openPauseFromQueue([item({ id: "a" }), item({ id: "b", kind: PAUSE_END_KIND, body: { start_submission_id: "kX" } })]),
    ).toBeNull();
  });

  it("does not reopen a start whose end was queued before it", () => {
    expect(
      openPauseFromQueue([item({ id: "a", kind: PAUSE_END_KIND, body: { start_submission_id: "k1" } }), item({ id: "b", body: { start_submission_id: "k1" } })]),
    ).toBeNull();
  });

  it("ignores a failed end", () => {
    expect(
      openPauseFromQueue([item({ id: "a" }), item({ id: "b", kind: PAUSE_END_KIND, status: "failed" })])?.startSubmissionId,
    ).toBe("k0");
  });

  it("keeps the tap time and drops unusable notes and coordinates", () => {
    expect(
      openPauseFromQueue([
        item({ body: { occurred_at: "2026-10-06T09:59:00.000Z", note: "", latitude: Number.NaN, longitude: Infinity } }),
      ]),
    ).toEqual({
      startSubmissionId: "k0",
      kind: "MEAL",
      startedAt: "2026-10-06T09:59:00.000Z",
      note: null,
      latitude: null,
      longitude: null,
    });

    expect(
      openPauseFromQueue([item({ body: { occurred_at: "", note: 5, latitude: "1", longitude: -46.6 } })]),
    ).toEqual({
      startSubmissionId: "k0",
      kind: "MEAL",
      startedAt: "2026-10-06T10:00:00.000Z",
      note: null,
      latitude: null,
      longitude: -46.6,
    });
  });
});

describe("resolvePause and shouldAdoptServer", () => {
  it("keeps the phone's record for a server answer asked at the same instant", () => {
    const local = { open: open(), changedAt: 1000 };

    expect(resolvePause({ local, server: { open: null, requestedAt: 1000 }, queued: [], sending: false })).toEqual({
      open: local.open,
      source: "local",
    });
  });

  it("adopts a later server answer that closed the phone's pause", () => {
    expect(
      shouldAdoptServer({
        local: { open: open(), changedAt: 1000 },
        server: { open: null, requestedAt: 2000 },
        queued: [],
        sending: false,
      }),
    ).toBe(true);
  });
});

describe("isStartQueued", () => {
  it("finds the start among other queued gestures, and only a start", () => {
    const other = item({ id: "x", body: { start_submission_id: "kX" } });

    expect(isStartQueued(open(), [other, item({ id: "a" })])).toBe(true);
    expect(isStartQueued(open(), [item({ id: "e", kind: PAUSE_END_KIND })])).toBe(false);
  });
});

describe("bodies", () => {
  it("cleans a blank note to none", () => {
    expect(normalizePauseNote("   ")).toBeNull();
    expect(normalizePauseNote("")).toBeNull();
  });

  it("never sends half a position", () => {
    const base = { startSubmissionId: "k0", kind: "MEAL" as const, occurredAt: "2026-10-06T10:00:00.000Z" };

    expect(startPauseBody({ ...base, coordinates: { latitude: -23.5, longitude: null as unknown as number } })).toEqual({
      kind: "MEAL",
      start_submission_id: "k0",
      occurred_at: base.occurredAt,
    });
    expect(startPauseBody({ ...base, coordinates: { latitude: null as unknown as number, longitude: -46.6 } })).toEqual({
      kind: "MEAL",
      start_submission_id: "k0",
      occurred_at: base.occurredAt,
    });
  });
});

describe("openPauseFromServer and currentPauseFromResponse", () => {
  const raw = {
    start_submission_id: "k0",
    started_at: "2026-10-06T10:00:00.000Z",
    kind: "REST",
  };

  it("refuses a non-object even when it carries the fields", () => {
    expect(openPauseFromServer(Object.assign(() => undefined, raw))).toBeNull();
  });

  it("refuses each missing or bad field on its own", () => {
    expect(openPauseFromServer({ ...raw, start_submission_id: "" })).toBeNull();
    expect(openPauseFromServer({ ...raw, started_at: undefined })).toBeNull();
    expect(openPauseFromServer({ ...raw, kind: "NAP" })).toBeNull();
    expect(openPauseFromServer({ ...raw, started_at: "ontem" })).toBeNull();
  });

  it("only reads the type from an object", () => {
    // A function cannot take `name` (read-only); `id` is enough to be read.
    const typeFn = Object.assign(() => undefined, { id: "t1" });

    expect(openPauseFromServer({ ...raw, occurrence_type: typeFn })).not.toHaveProperty("occurrenceTypeId");
    expect(openPauseFromServer({ ...raw, occurrence_type: { id: "t1", name: "Cochilo" } })).toMatchObject({
      occurrenceTypeId: "t1",
      typeName: "Cochilo",
    });
  });

  it("does not understand a null or non-object answer", () => {
    expect(currentPauseFromResponse(null)).toBeUndefined();
    expect(currentPauseFromResponse("open")).toBeUndefined();
    expect(currentPauseFromResponse({ open: null })).toBeNull();
  });
});

describe("pauseRefusalVerdict", () => {
  it("does not wait on an end queued after this start", () => {
    const start = item({ id: "s", body: { start_submission_id: "k1" } });
    const laterEnd = item({ id: "e", kind: PAUSE_END_KIND, body: { start_submission_id: "k0" } });

    expect(pauseRefusalVerdict(start, "PAUSE_ALREADY_OPEN", [start, laterEnd])).toEqual({
      outcome: "settled",
      reason: "other-pause-open",
    });
  });

  it("does not wait on an earlier start", () => {
    const earlier = item({ id: "a", body: { start_submission_id: "k0" } });
    const start = item({ id: "s", body: { start_submission_id: "k1" } });

    expect(pauseRefusalVerdict(start, "PAUSE_ALREADY_OPEN", [earlier, start])).toEqual({
      outcome: "settled",
      reason: "other-pause-open",
    });
  });

  it("waits on any end still queued when the start itself is no longer in the queue", () => {
    const start = item({ id: "s", body: { start_submission_id: "k1" } });
    const end = item({ id: "e", kind: PAUSE_END_KIND, body: { start_submission_id: "k0" } });

    expect(pauseRefusalVerdict(start, "PAUSE_ALREADY_OPEN", [end])).toEqual({ outcome: "retry" });
  });
});
