import { describe, expect, it } from "vitest";

import {
  PAUSE_END_KIND,
  PAUSE_START_KIND,
  canStartPause,
  currentPauseFromResponse,
  endPauseBody,
  formatPauseDuration,
  formatPauseElapsed,
  isPauseAllowed,
  isStartQueued,
  openPauseFromServer,
  openPauseTitle,
  pauseChoicesOf,
  mustQueueBehind,
  openPauseFromQueue,
  pauseRefusalVerdict,
  queuedPauseItems,
  resolvePause,
  settledPauseState,
  shouldAdoptServer,
  startPauseBody,
  type OpenPause,
  type QueuedPauseItem,
} from "@/features/pauses/pause-rules";
import {
  endPauseBodySchema,
  parsePauseBody,
  pauseNoteFormSchema,
  startPauseBodySchema,
} from "@/features/pauses/pause-schemas";
import { moduleOfSubmission } from "@/features/access/module-rules";
import { describePendingItem } from "@/features/submissions/pending-item-rules";
import { isSendExpired } from "@/features/submissions/outbox-rules";

/**
 * The driver's pause (decision 6.1; docs/contratos-app/pauses.md), as the app
 * decides it: whose word says the driver is on a pause, what each gesture
 * sends, and what a refusal of a queued gesture means.
 */

const START_A = "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01";
const END_A = "1c4d7d1f-9a8b-4b62-8e8f-3a2d6c9b0f12";
const START_B = "2d5e8e2a-0b9c-4c73-9f90-4b3e7d0c1a23";

const pauseA: OpenPause = {
  startSubmissionId: START_A,
  kind: "MEAL",
  startedAt: "2026-09-29T15:00:00.000Z",
  note: null,
  latitude: null,
  longitude: null,
};

const pauseB: OpenPause = { ...pauseA, startSubmissionId: START_B, kind: "REST" };

function queued(
  id: string,
  kind: string,
  body: Record<string, unknown>,
  status = "pending",
): QueuedPauseItem {
  return {
    id,
    kind,
    status,
    businessId: "business-1",
    ownerUserId: "user-a",
    body,
    createdAt: "2026-09-29T15:00:00.000Z",
  };
}

const startOf = (key: string, status = "pending") =>
  queued(key, PAUSE_START_KIND, { kind: "MEAL", start_submission_id: key, occurred_at: "2026-09-29T15:00:00.000Z" }, status);

const endOf = (startKey: string, endKey: string, status = "pending") =>
  queued(endKey, PAUSE_END_KIND, { start_submission_id: startKey, end_submission_id: endKey }, status);

describe("whose word says the driver is on a pause", () => {
  it("the phone's, while a gesture is being sent — the server does not know it yet", () => {
    const resolved = resolvePause({
      local: { open: pauseA, changedAt: 1_000 },
      server: { open: null, requestedAt: 2_000 },
      queued: [],
      sending: true,
    });

    expect(resolved).toEqual({ open: pauseA, source: "local" });
  });

  it("the phone's, while a pause gesture is still in the queue", () => {
    const resolved = resolvePause({
      local: { open: null, changedAt: 1_000 },
      server: { open: pauseA, requestedAt: 2_000 },
      queued: [endOf(START_A, END_A)],
      sending: false,
    });

    expect(resolved.open).toBeNull();
  });

  it("the server's, when it was ASKED after the record's last change (a tap, or a gesture settled)", () => {
    const resolved = resolvePause({
      local: { open: pauseA, changedAt: 1_000 },
      server: { open: null, requestedAt: 2_000 },
      queued: [],
      sending: false,
    });

    expect(resolved).toEqual({ open: null, source: "server" });
  });

  it("a FAILED item never holds the screen: it reached nothing, and the server's pause shows", () => {
    // The end was refused for good (a reused key): the pause is still open on
    // the server, and the driver must see it to end it again.
    const input = {
      local: { open: null, changedAt: 1_000 },
      server: { open: pauseA, requestedAt: 2_000 },
      queued: [endOf(START_A, END_A, "failed")],
      sending: false,
    };

    expect(resolvePause(input)).toEqual({ open: pauseA, source: "server" });
    expect(shouldAdoptServer(input)).toBe(true);

    // Parked (Entregas off) is still on its way: the phone keeps its word.
    expect(
      resolvePause({ ...input, queued: [endOf(START_A, END_A, "parked")] }).open,
    ).toBeNull();
  });

  it("an answer asked while the gesture was still queued never wins once the gesture lands", () => {
    // 1000: start tapped offline. 2000: /current asked on reconnect, before
    // the queued start reached the API. 3000: the queue delivers it.
    const snapshot = { open: null, requestedAt: 2_000 };
    const local = settledPauseState({ open: pauseA, changedAt: 1_000 }, null, 3_000);

    const drained = { local, server: snapshot, queued: [], sending: false };
    expect(resolvePause(drained)).toEqual({ open: pauseA, source: "local" });
    expect(shouldAdoptServer(drained)).toBe(false);

    // The same for an end: the ended pause does not come back.
    const ended = {
      local: settledPauseState({ open: null, changedAt: 1_000 }, null, 3_000),
      server: { open: pauseA, requestedAt: 2_000 },
      queued: [],
      sending: false,
    };
    expect(resolvePause(ended).open).toBeNull();
    expect(shouldAdoptServer(ended)).toBe(false);

    // An answer asked after the landing is the server's word again.
    expect(resolvePause({ ...drained, server: { open: null, requestedAt: 4_000 } })).toEqual({
      open: null,
      source: "server",
    });
  });

  it("a settled gesture keeps what the phone shows, dated now; without a record, the queue's word", () => {
    expect(settledPauseState({ open: pauseA, changedAt: 1_000 }, null, 3_000)).toEqual({
      open: pauseA,
      changedAt: 3_000,
    });

    // Never back in time.
    expect(settledPauseState({ open: pauseA, changedAt: 5_000 }, null, 3_000).changedAt).toBe(5_000);

    expect(settledPauseState(null, pauseB, 3_000)).toEqual({ open: pauseB, changedAt: 3_000 });
  });

  it("never an answer asked before the tap: it would take a pause just started off screen", () => {
    const resolved = resolvePause({
      local: { open: pauseA, changedAt: 2_000 },
      server: { open: null, requestedAt: 1_000 },
      queued: [],
      sending: false,
    });

    expect(resolved).toEqual({ open: pauseA, source: "local" });
  });

  it("the same pause keeps the phone's start, so a phone with a skewed clock still times it right", () => {
    // The server's started_at is on the server's clock; the timer runs on the
    // phone's. A phone five minutes fast would otherwise gain five minutes.
    const server = { open: { ...pauseA, startedAt: "2026-09-29T14:55:00.000Z" }, requestedAt: 2_000 };
    const local = { open: pauseA, changedAt: 1_000 };

    expect(resolvePause({ local, server, queued: [], sending: false })).toEqual({
      open: pauseA,
      source: "server",
    });
    expect(shouldAdoptServer({ local, server, queued: [], sending: false })).toBe(false);
  });

  it("the server's after a reinstall: no record on the phone at all", () => {
    expect(
      resolvePause({ local: null, server: { open: pauseB, requestedAt: 1 }, queued: [], sending: false }),
    ).toEqual({ open: pauseB, source: "server" });
  });

  it("the queue's, when the phone lost its record but the gestures are still queued", () => {
    const resolved = resolvePause({
      local: null,
      server: { open: null, requestedAt: 5_000 },
      queued: [startOf(START_A)],
      sending: false,
    });

    expect(resolved.source).toBe("queue");
    expect(resolved.open).toMatchObject({ startSubmissionId: START_A, kind: "MEAL" });
  });

  it("nobody's word is no pause", () => {
    expect(resolvePause({ local: null, server: null, queued: [], sending: false })).toEqual({
      open: null,
      source: "none",
    });
  });

  it("the phone adopts the server's answer only when the server won and says something else", () => {
    const server = { open: pauseB, requestedAt: 2_000 };

    expect(
      shouldAdoptServer({ local: { open: null, changedAt: 1_000 }, server, queued: [], sending: false }),
    ).toBe(true);

    expect(
      shouldAdoptServer({ local: { open: pauseB, changedAt: 1_000 }, server, queued: [], sending: false }),
    ).toBe(false);

    expect(
      shouldAdoptServer({ local: { open: null, changedAt: 3_000 }, server, queued: [], sending: false }),
    ).toBe(false);
  });

  it("one pause at a time", () => {
    expect(canStartPause({ open: pauseA, source: "local" })).toBe(false);
    expect(canStartPause({ open: null, source: "server" })).toBe(true);
  });
});

describe("the queue as the pause reads it", () => {
  it("only this driver's pause gestures for this company", () => {
    const mine = startOf(START_A);
    const items = [
      mine,
      { ...startOf(START_B), ownerUserId: "user-b" },
      { ...startOf(START_B), businessId: "business-2" },
      queued("x", "delivery-arrival", {}),
    ];

    expect(queuedPauseItems(items, { ownerUserId: "user-a", businessId: "business-1" })).toEqual([
      mine,
    ]);
  });

  it("the open pause is the last start whose own end is not queued", () => {
    expect(openPauseFromQueue([startOf(START_A)])?.startSubmissionId).toBe(START_A);
    expect(openPauseFromQueue([startOf(START_A), endOf(START_A, END_A)])).toBeNull();
    expect(
      openPauseFromQueue([startOf(START_A), endOf(START_A, END_A), startOf(START_B)])
        ?.startSubmissionId,
    ).toBe(START_B);
  });

  it("a failed start is not an open pause, even as the queue's word", () => {
    expect(openPauseFromQueue([startOf(START_A, "failed")])).toBeNull();
    expect(openPauseFromQueue([startOf(START_A, "parked")])?.startSubmissionId).toBe(START_A);
  });

  it("a new gesture goes behind anything still waiting, never behind a failure", () => {
    expect(mustQueueBehind([])).toBe(false);
    expect(mustQueueBehind([endOf(START_A, END_A)])).toBe(true);
    expect(mustQueueBehind([endOf(START_A, END_A, "parked")])).toBe(true);
    expect(mustQueueBehind([endOf(START_A, END_A, "failed")])).toBe(false);
  });

  it("says when the open pause's start is only on this phone", () => {
    expect(isStartQueued(pauseA, [startOf(START_A)])).toBe(true);
    expect(isStartQueued(pauseA, [startOf(START_B)])).toBe(false);
    expect(isStartQueued(null, [startOf(START_A)])).toBe(false);
  });
});

describe("what each gesture sends", () => {
  it("the start: kind, key, tap; the note cleaned; a position only as a pair", () => {
    const body = startPauseBody({
      startSubmissionId: START_A,
      kind: "MEAL",
      occurredAt: "2026-09-29T15:00:00.000Z",
      note: "  Almoço   no\nposto ",
      coordinates: { latitude: -23.55, longitude: -46.63 },
    });

    expect(body).toEqual({
      kind: "MEAL",
      start_submission_id: START_A,
      occurred_at: "2026-09-29T15:00:00.000Z",
      latitude: -23.55,
      longitude: -46.63,
      note: "Almoço no posto",
    });

    expect(
      startPauseBody({
        startSubmissionId: START_A,
        kind: "REST",
        occurredAt: "2026-09-29T15:00:00.000Z",
        note: "   ",
      }),
    ).toEqual({ kind: "REST", start_submission_id: START_A, occurred_at: "2026-09-29T15:00:00.000Z" });
  });

  it("the end ALWAYS carries the start, so it can land before it", () => {
    const body = endPauseBody(
      { ...pauseA, note: "Almoço", latitude: -23.55, longitude: -46.63 },
      { endSubmissionId: END_A, occurredAt: "2026-09-29T16:00:00.000Z", coordinates: null },
    );

    expect(body).toEqual({
      start_submission_id: START_A,
      end_submission_id: END_A,
      occurred_at: "2026-09-29T16:00:00.000Z",
      start: {
        kind: "MEAL",
        occurred_at: "2026-09-29T15:00:00.000Z",
        latitude: -23.55,
        longitude: -46.63,
        note: "Almoço",
      },
    });
  });

  it("both bodies pass the API's rules as the app mirrors them", () => {
    const start = parsePauseBody(
      startPauseBodySchema,
      startPauseBody({ startSubmissionId: START_A, kind: "OTHER", occurredAt: "2026-09-29T15:00:00.000Z" }),
    );
    expect(start).toEqual({ kind: "OTHER", start_submission_id: START_A, occurred_at: "2026-09-29T15:00:00.000Z" });

    const end = parsePauseBody(
      endPauseBodySchema,
      endPauseBody(pauseA, { endSubmissionId: END_A, occurredAt: "2026-09-29T16:00:00.000Z" }),
    );
    expect(end.start).toEqual({ kind: "MEAL", occurred_at: "2026-09-29T15:00:00.000Z" });
  });

  it("refuses what the API would refuse, before it can be queued", () => {
    expect(() =>
      parsePauseBody(startPauseBodySchema, { kind: "LUNCH", start_submission_id: START_A, occurred_at: "2026-09-29T15:00:00.000Z" }),
    ).toThrow("Tipo de pausa inválido");

    expect(() =>
      parsePauseBody(startPauseBodySchema, { kind: "MEAL", start_submission_id: "abc", occurred_at: "2026-09-29T15:00:00.000Z" }),
    ).toThrow("A chave do envio (início) é inválida.");

    expect(() =>
      parsePauseBody(endPauseBodySchema, { start_submission_id: START_A, end_submission_id: END_A, occurred_at: "2026-09-29T16:00:00.000Z" }),
    ).toThrow();
  });

  it("a note is limited to 200 characters AFTER cleaning, like the API", () => {
    expect(pauseNoteFormSchema.safeParse({ note: `${"a".repeat(200)}     ` }).success).toBe(true);
    expect(pauseNoteFormSchema.safeParse({ note: "a".repeat(201) }).success).toBe(false);
    expect(pauseNoteFormSchema.safeParse({ note: "" }).success).toBe(true);
  });
});

describe("the server's /current", () => {
  it("reads the open pause, with the key the end must name", () => {
    expect(
      currentPauseFromResponse({
        timeZone: "America/Sao_Paulo",
        day: "2026-09-29",
        open: {
          id: "p1",
          kind: "REST",
          started_at: "2026-09-29T15:02:11.000Z",
          ended_at: null,
          note: null,
          start_submission_id: START_B,
          start_latitude: -23.55,
          start_longitude: -46.63,
        },
        today: [],
      }),
    ).toEqual({
      startSubmissionId: START_B,
      kind: "REST",
      startedAt: "2026-09-29T15:02:11.000Z",
      note: null,
      latitude: -23.55,
      longitude: -46.63,
    });
  });

  it("no open pause is null; an answer it does not understand is ignored, never 'no pause'", () => {
    expect(currentPauseFromResponse({ open: null, today: [] })).toBeNull();
    expect(currentPauseFromResponse({ data: {} })).toBeUndefined();
    expect(currentPauseFromResponse({ open: { kind: "MEAL" } })).toBeUndefined();
  });
});

describe("a refusal of a queued pause gesture (the contract's error table)", () => {
  const owner = { ownerUserId: "user-a" };

  it("too old, start or end: settled — nothing was recorded, nothing to show", () => {
    expect(pauseRefusalVerdict(startOf(START_A), "PAUSE_TOO_OLD", [])).toEqual({
      outcome: "settled",
      reason: "too-old",
    });
    expect(pauseRefusalVerdict(endOf(START_A, END_A), "PAUSE_TOO_OLD", [])).toEqual({
      outcome: "settled",
      reason: "too-old",
    });
  });

  it("an end already ended: settled", () => {
    expect(pauseRefusalVerdict(endOf(START_A, END_A), "PAUSE_ALREADY_ENDED", [])).toEqual({
      outcome: "settled",
      reason: "already-ended",
    });
  });

  it("a start already open with its own end queued: merged into the end", () => {
    const start = startOf(START_A);
    const queue = [start, endOf(START_A, END_A)];

    expect(pauseRefusalVerdict({ ...start, ...owner }, "PAUSE_ALREADY_OPEN", queue)).toEqual({
      outcome: "settled",
      reason: "merged-into-end",
    });
  });

  it("a start already open behind another pause's end still waiting: retried", () => {
    const start = startOf(START_B);
    const queue = [endOf(START_A, END_A), start];

    expect(pauseRefusalVerdict(start, "PAUSE_ALREADY_OPEN", queue)).toEqual({ outcome: "retry" });
  });

  it("a start already open behind an end that FAILED: the server's pause is shown instead", () => {
    const start = startOf(START_B);
    const queue = [endOf(START_A, END_A, "failed"), start];

    expect(pauseRefusalVerdict(start, "PAUSE_ALREADY_OPEN", queue)).toEqual({
      outcome: "settled",
      reason: "other-pause-open",
    });
  });

  it("the rest stays the queue's to decide (visible failures)", () => {
    expect(pauseRefusalVerdict(endOf(START_A, END_A), "PAUSE_SUBMISSION_REUSED", [])).toBeNull();
    expect(pauseRefusalVerdict(startOf(START_A), "SUBMISSION_OWNER_MISMATCH", [])).toBeNull();
    expect(pauseRefusalVerdict(endOf(START_A, END_A), "PAUSE_ALREADY_OPEN", [])).toBeNull();
    expect(pauseRefusalVerdict(queued("x", "delivery-arrival", {}), "PAUSE_TOO_OLD", [])).toBeNull();
  });
});

describe("the queue's own rules for the new kinds", () => {
  it("belong to the Entregas module, so a refusal for a disabled module parks them", () => {
    expect(moduleOfSubmission(PAUSE_START_KIND)).toBe("DELIVERIES");
    expect(moduleOfSubmission(PAUSE_END_KIND)).toBe("DELIVERIES");
    expect(moduleOfSubmission("delivery-on-the-way")).toBe("DELIVERIES");

    const view = describePendingItem(
      { kind: PAUSE_START_KIND, createdAt: "2026-09-29T15:00:00.000Z", status: "parked", attempts: 0 },
      "own",
      Date.parse("2026-09-29T16:00:00.000Z"),
    );

    expect(view.message).toContain("Entregas");
  });

  it("never expire like a departure: a late pause is the API's to date", () => {
    for (const kind of [PAUSE_START_KIND, PAUSE_END_KIND, "delivery-on-the-way"]) {
      expect(isSendExpired({ kind, createdAt: "2026-09-01T00:00:00.000Z" }, Date.parse("2026-09-29T00:00:00.000Z"))).toBe(false);
    }
  });
});

describe("the timer", () => {
  const start = "2026-09-29T15:00:00.000Z";
  const at = (seconds: number) => Date.parse(start) + seconds * 1000;

  it("counts from the start, with hours once past one", () => {
    expect(formatPauseElapsed(start, at(0))).toBe("00:00");
    expect(formatPauseElapsed(start, at(12 * 60 + 5))).toBe("12:05");
    expect(formatPauseElapsed(start, at(3723))).toBe("1:02:03");
  });

  it("never goes negative on a clock set back", () => {
    expect(formatPauseElapsed(start, at(-30))).toBe("00:00");
  });

  it("says how long a pause lasted in whole minutes", () => {
    expect(formatPauseDuration(start, at(42 * 60 + 59))).toBe("42 min");
    expect(formatPauseDuration(start, at(65 * 60))).toBe("1 h 05 min");
  });
});

describe("pauses as the company's pause types, inside a journey (decision 14.4)", () => {
  const SNACK = "3e6f9f3b-1c0d-4d84-8a01-5c4f8e1d2b34";

  it("offers the company's types with their nature, and the three natures on an old cached day", () => {
    expect(
      pauseChoicesOf([
        { id: SNACK, name: "Lanche", pause_kind: "REST" },
        { id: "x", name: "Estranho", pause_kind: "UNKNOWN" },
      ]),
    ).toEqual([
      { occurrenceTypeId: SNACK, kind: "REST", label: "Lanche", description: "Natureza: Descanso" },
    ]);
    expect(pauseChoicesOf(undefined).map((choice) => [choice.occurrenceTypeId, choice.kind])).toEqual([
      [null, "MEAL"],
      [null, "REST"],
      [null, "OTHER"],
    ]);
  });

  it("sends the chosen type with its nature, at the start and in the end's repeated start", () => {
    const start = startPauseBody({
      startSubmissionId: START_A,
      kind: "REST",
      occurrenceTypeId: SNACK,
      occurredAt: "2026-09-29T15:00:00.000Z",
    });

    expect(start).toMatchObject({ kind: "REST", occurrence_type_id: SNACK });
    expect(parsePauseBody(startPauseBodySchema, start)).toMatchObject({ occurrence_type_id: SNACK });

    const end = endPauseBody(
      { ...pauseA, kind: "REST", occurrenceTypeId: SNACK },
      { endSubmissionId: END_A, occurredAt: "2026-09-29T15:30:00.000Z" },
    );

    expect(end.start).toMatchObject({ kind: "REST", occurrence_type_id: SNACK });
    expect(parsePauseBody(endPauseBodySchema, end)).toMatchObject({
      start: { occurrence_type_id: SNACK },
    });
    // The installed contract's body: the nature alone.
    expect(startPauseBody({ startSubmissionId: START_A, kind: "MEAL", occurredAt: "2026-09-29T15:00:00.000Z" })).not.toHaveProperty(
      "occurrence_type_id",
    );
  });

  it("reads the type of a pause the server reports, and titles the banner with it", () => {
    const open = openPauseFromServer({
      start_submission_id: START_A,
      kind: "REST",
      started_at: "2026-09-29T15:00:00.000Z",
      note: null,
      occurrence_type: { id: SNACK, name: "Lanche" },
    });

    expect(open).toMatchObject({ occurrenceTypeId: SNACK, typeName: "Lanche" });
    expect(openPauseTitle(open!)).toBe("Pausa: Lanche");
    expect(openPauseTitle(pauseA)).toBe("Pausa para refeição");
  });

  it("offers Iniciar pausa only inside a journey, the server's word first", () => {
    const onRoute = (status: string) => ({
      data: [{ stops: [{ route: { status } }] }],
    });

    expect(isPauseAllowed(onRoute("IN_PROGRESS"))).toBe(true);
    expect(isPauseAllowed(onRoute("RELEASED"))).toBe(true);
    expect(isPauseAllowed(onRoute("COMPLETED"))).toBe(false);
    expect(isPauseAllowed({ data: [{ stops: [] }] })).toBe(false);
    expect(isPauseAllowed(undefined)).toBe(false);
    // The server's answer wins over the stops (a route released for tomorrow)
    // — for the business day it was given in.
    const today = { day: "2026-10-05", time_zone: "America/Sao_Paulo" };
    const noon = new Date("2026-10-05T15:00:00Z");

    expect(
      isPauseAllowed({ ...onRoute("RELEASED"), journey: { pause_allowed: false, ...today } }, noon),
    ).toBe(false);
    expect(isPauseAllowed({ data: [], journey: { pause_allowed: true, ...today } }, noon)).toBe(true);
  });

  // Review r1: the cache lives up to 7 days offline.
  describe("on a day cached earlier", () => {
    const yesterday = { day: "2026-10-04", time_zone: "America/Sao_Paulo" };
    // 10:00 in São Paulo on the 5th.
    const now = new Date("2026-10-05T13:00:00Z");

    const released = (scheduled_date: string | null) => ({
      data: [{ stops: [{ route: { status: "RELEASED", scheduled_date } }] }],
    });

    it("does not trust yesterday's 'allowed' on a day without a route", () => {
      expect(isPauseAllowed({ data: [], journey: { pause_allowed: true, ...yesterday } }, now)).toBe(
        false,
      );
    });

    it("does not let yesterday's 'not allowed' hide a pause on today's route", () => {
      expect(
        isPauseAllowed(
          { ...released("2026-10-05T00:00:00.000Z"), journey: { pause_allowed: false, ...yesterday } },
          now,
        ),
      ).toBe(true);
    });

    it("counts a RELEASED route only on its own day", () => {
      expect(isPauseAllowed(released("2026-10-06T00:00:00.000Z"), now)).toBe(false);
      expect(isPauseAllowed(released("2026-10-05T00:00:00.000Z"), now)).toBe(true);
      // The delivery's day when the route's is not cached.
      expect(
        isPauseAllowed(
          { data: [{ scheduled_date: "2026-10-06", stops: [{ route: { status: "RELEASED" } }] }] },
          now,
        ),
      ).toBe(false);
    });

    it("keeps a route IN_PROGRESS past midnight, and judges the day in the company's zone", () => {
      const pastMidnight = {
        data: [{ stops: [{ route: { status: "IN_PROGRESS", scheduled_date: "2026-10-04T00:00:00.000Z" } }] }],
      };

      expect(isPauseAllowed(pastMidnight, now)).toBe(true);

      // 01:30 UTC on the 6th is still the 5th in São Paulo (22:30).
      const lateEvening = new Date("2026-10-06T01:30:00Z");

      expect(isPauseAllowed(released("2026-10-05T00:00:00.000Z"), lateEvening)).toBe(true);
      expect(
        isPauseAllowed(
          { data: [], journey: { pause_allowed: true, day: "2026-10-05", time_zone: "America/Sao_Paulo" } },
          lateEvening,
        ),
      ).toBe(true);
    });
  });

  it("drops a gesture refused outside a journey without a red card, start or end", () => {
    expect(pauseRefusalVerdict(startOf(START_A), "PAUSE_REQUIRES_ROUTE", [])).toEqual({
      outcome: "settled",
      reason: "requires-route",
    });
    expect(pauseRefusalVerdict(endOf(START_A, END_A), "PAUSE_REQUIRES_ROUTE", [])).toEqual({
      outcome: "settled",
      reason: "requires-route",
    });
  });
});
