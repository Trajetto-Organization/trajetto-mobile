import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  ON_THE_WAY_KIND,
  confirmedOnTheWayAt,
  currentOnTheWayStopId,
  onTheWayEndpoint,
  onTheWayLabel,
  onTheWayRefusalVerdict,
  onTheWayTarget,
  onTheWayView,
  phoneClockSkewMs,
  type OnTheWayDelivery,
} from "@/features/deliveries/on-the-way-rules";
import { onTheWayBodySchema } from "@/features/deliveries/on-the-way-schema";
import {
  MARK_TTL_MS,
  MAX_MARKS_PER_SCOPE,
  prunedMarks,
} from "@/features/deliveries/on-the-way-store";

/**
 * "Estou a caminho" (decision 6.4; docs/contratos-app/on-the-way.md), as the
 * app decides it: which stop offers the button, which stop is "a caminho" now
 * — the API's rule, run side by side with the API's own file when
 * ../trajetto-api is checked out — and what a refusal from the queue means.
 */

const API_RULES = join(
  process.cwd(),
  "..",
  "trajetto-api",
  "src",
  "modules",
  "route",
  "usecases",
  "mark-stop-on-the-way",
  "on-the-way-rules.ts",
);

type Case = {
  name: string;
  stops: Array<{ id: string; status: string; on_the_way_at: string | null }>;
  current: string | null;
};

const CASES: Case[] = [
  {
    name: "no mark",
    stops: [
      { id: "a", status: "PENDING", on_the_way_at: null },
      { id: "b", status: "PENDING", on_the_way_at: null },
    ],
    current: null,
  },
  {
    name: "the latest of two marks",
    stops: [
      { id: "a", status: "PENDING", on_the_way_at: "2026-09-29T13:00:00.000Z" },
      { id: "b", status: "PENDING", on_the_way_at: "2026-09-29T14:00:00.000Z" },
    ],
    current: "b",
  },
  {
    name: "the latest-marked stop reached: none, the older mark stays history",
    stops: [
      { id: "a", status: "PENDING", on_the_way_at: "2026-09-29T13:00:00.000Z" },
      { id: "b", status: "ARRIVED", on_the_way_at: "2026-09-29T14:00:00.000Z" },
    ],
    current: null,
  },
  {
    name: "the latest-marked stop delivered: none",
    stops: [
      { id: "a", status: "PENDING", on_the_way_at: "2026-09-29T13:00:00.000Z" },
      { id: "b", status: "COMPLETED", on_the_way_at: "2026-09-29T14:00:00.000Z" },
      { id: "c", status: "PENDING", on_the_way_at: null },
    ],
    current: null,
  },
  {
    name: "a tie goes to the greater id",
    stops: [
      { id: "b", status: "PENDING", on_the_way_at: "2026-09-29T13:00:00.000Z" },
      { id: "a", status: "PENDING", on_the_way_at: "2026-09-29T13:00:00.000Z" },
    ],
    current: "b",
  },
  {
    name: "an unreadable instant is no mark",
    stops: [
      { id: "a", status: "PENDING", on_the_way_at: "ontem" },
      { id: "b", status: "PENDING", on_the_way_at: "2026-09-29T13:00:00.000Z" },
    ],
    current: "b",
  },
];

/** The API's rules file, compiled and evaluated here (it imports nothing). */
function loadApiRules(): { currentOnTheWayStopId: (stops: Case["stops"]) => string | null } {
  const compiled = ts.transpileModule(readFileSync(API_RULES, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;

  const module = { exports: {} as Record<string, unknown> };

  new Function("module", "exports", compiled)(module, module.exports);

  return module.exports as ReturnType<typeof loadApiRules>;
}

describe("the stop that is 'a caminho' right now", () => {
  it.each(CASES)("$name", ({ stops, current }) => {
    expect(currentOnTheWayStopId(stops)).toBe(current);
  });

  const hasApi = existsSync(API_RULES);

  it.skipIf(!hasApi)(
    `answers exactly what the API's rule answers${hasApi ? "" : " — skipped: ../trajetto-api is not checked out"}`,
    () => {
      const api = loadApiRules();

      for (const { name, stops } of CASES) {
        expect(currentOnTheWayStopId(stops), name).toBe(api.currentOnTheWayStopId(stops));
      }
    },
  );
});

// ------------------------------------------------------------------ view

function delivery(
  id: string,
  stop: { id: string; status?: string; routeStatus?: string; routeId?: string; on_the_way_at?: string | null } | null,
): OnTheWayDelivery {
  return {
    id,
    stops: stop
      ? [
          {
            id: stop.id,
            status: stop.status ?? "PENDING",
            on_the_way_at: stop.on_the_way_at ?? null,
            route: { id: stop.routeId ?? "route-1", status: stop.routeStatus ?? "IN_PROGRESS" },
          },
        ]
      : [],
  };
}

function queuedMark(stopId: string, at: string, status = "pending", routeId = "route-1") {
  return {
    kind: ON_THE_WAY_KIND,
    status,
    endpoint: onTheWayEndpoint(stopId, routeId, "business-1"),
    body: { client_submission_id: `key-${stopId}`, occurred_at: at },
    createdAt: at,
  };
}

const queuedFor = (kind: string, path: string, deliveryId: string, body: Record<string, unknown> = {}) => ({
  kind,
  status: "pending",
  endpoint: `/delivery/${path}/${deliveryId}/business/business-1`,
  body,
  createdAt: "2026-09-29T15:00:00.000Z",
});

const A = delivery("delivery-a", { id: "stop-a" });
const B = delivery("delivery-b", { id: "stop-b" });

describe("what the delivery screen shows", () => {
  it("offers the button on a running route's pending stop", () => {
    expect(onTheWayView(A, { deliveries: [A, B], confirmed: {}, queue: [] })).toEqual({
      offer: true,
      current: false,
      since: null,
      queued: false,
    });
  });

  it("offers nothing before the route leaves, after it ends, or off a route", () => {
    for (const routeStatus of ["PLANNED", "RELEASED", "COMPLETED", "CANCELLED"]) {
      const entry = delivery("d", { id: "s", routeStatus });

      expect(onTheWayView(entry, { deliveries: [entry], confirmed: {}, queue: [] }).offer, routeStatus).toBe(
        false,
      );
    }

    const loose = delivery("d", null);
    expect(onTheWayView(loose, { deliveries: [loose], confirmed: {}, queue: [] }).offer).toBe(false);
  });

  it("offers nothing once the driver arrived, on the server or in the queue", () => {
    const arrived = delivery("delivery-a", { id: "stop-a", status: "ARRIVED" });
    expect(onTheWayView(arrived, { deliveries: [arrived], confirmed: {}, queue: [] }).offer).toBe(false);

    expect(
      onTheWayView(A, {
        deliveries: [A],
        confirmed: {},
        queue: [queuedFor("delivery-arrival", "arrival", "delivery-a")],
      }).offer,
    ).toBe(false);
  });

  it("a tap still in the queue is 'a caminho' at once, said to be only on the phone", () => {
    const view = onTheWayView(A, {
      deliveries: [A, B],
      confirmed: {},
      queue: [queuedMark("stop-a", "2026-09-29T15:02:00.000Z")],
    });

    expect(view).toEqual({
      offer: false,
      current: true,
      since: "2026-09-29T15:02:00.000Z",
      queued: true,
    });
  });

  it("a mark the API confirmed keeps the stop 'a caminho' after the queue let go of it", () => {
    const view = onTheWayView(A, {
      deliveries: [A, B],
      confirmed: { "stop-a": { routeId: "route-1", at: "2026-09-29T15:02:07.000Z" } },
      queue: [],
    });

    expect(view).toMatchObject({ current: true, since: "2026-09-29T15:02:07.000Z", queued: false });
  });

  it("reads the payload's own mark once the API serves it", () => {
    const served = delivery("delivery-a", { id: "stop-a", on_the_way_at: "2026-09-29T15:02:07.000Z" });

    expect(onTheWayView(served, { deliveries: [served], confirmed: {}, queue: [] }).current).toBe(true);
  });

  it("a refused tap never counts", () => {
    const view = onTheWayView(A, {
      deliveries: [A],
      confirmed: {},
      queue: [queuedMark("stop-a", "2026-09-29T15:02:00.000Z", "failed")],
    });

    expect(view).toMatchObject({ offer: true, current: false });
  });

  it("marking B after A: B is the one, A offers the button again", () => {
    const context = {
      deliveries: [A, B],
      confirmed: { "stop-a": { routeId: "route-1", at: "2026-09-29T15:00:00.000Z" } },
      queue: [queuedMark("stop-b", "2026-09-29T15:30:00.000Z")],
    };

    expect(onTheWayView(B, context).current).toBe(true);
    expect(onTheWayView(A, context)).toMatchObject({ current: false, offer: true });
  });

  it("a phone running slow never ranks a tap on B, made after A was confirmed, before A", () => {
    // Five minutes slow: A was tapped at 14:57 on the phone and the API
    // recorded 15:02. B is tapped three minutes later: 15:00 on the phone,
    // 15:05 in fact. Unshifted, B's 15:00 would lose to A's 15:02.
    const context = {
      deliveries: [A, B],
      confirmed: {
        "stop-a": {
          routeId: "route-1",
          at: "2026-09-29T15:02:00.000Z",
          tappedAt: "2026-09-29T14:57:00.000Z",
        },
      },
      queue: [queuedMark("stop-b", "2026-09-29T15:00:00.000Z")],
    };

    expect(onTheWayView(B, context)).toEqual({
      offer: false,
      current: true,
      since: "2026-09-29T15:05:00.000Z",
      queued: true,
    });
    expect(onTheWayView(A, context)).toMatchObject({ current: false, offer: true });
  });

  it("learns the phone's clock error from the newest confirmed mark, and assumes none without one", () => {
    expect(phoneClockSkewMs({})).toBe(0);

    // Marks confirmed by an older API carry no tap: nothing to learn.
    expect(phoneClockSkewMs({ "stop-a": { routeId: "route-1", at: "2026-09-29T15:02:00.000Z" } })).toBe(0);

    expect(
      phoneClockSkewMs({
        "stop-a": { routeId: "route-1", at: "2026-09-29T15:02:00.000Z", tappedAt: "2026-09-29T14:57:00.000Z" },
        // Newer: the phone's clock was fixed since.
        "stop-b": { routeId: "route-1", at: "2026-09-29T16:00:00.000Z", tappedAt: "2026-09-29T16:00:01.000Z" },
      }),
    ).toBe(-1_000);
  });

  it("the latest-marked stop resolved and gone from the list: an older mark does not come back", () => {
    // B was marked last and delivered: it left the working list.
    const view = onTheWayView(A, {
      deliveries: [A],
      confirmed: {
        "stop-a": { routeId: "route-1", at: "2026-09-29T15:00:00.000Z" },
        "stop-b": { routeId: "route-1", at: "2026-09-29T15:30:00.000Z" },
      },
      queue: [],
    });

    expect(view).toMatchObject({ current: false, offer: true });
  });

  it("a mark on another route never shadows this one", () => {
    const view = onTheWayView(A, {
      deliveries: [A],
      confirmed: {
        "stop-a": { routeId: "route-1", at: "2026-09-29T15:00:00.000Z" },
        "stop-z": { routeId: "route-2", at: "2026-09-29T15:30:00.000Z" },
      },
      queue: [],
    });

    expect(view.current).toBe(true);
  });

  it("a proof or a blocking occurrence in the queue ends it; a non-blocking one does not", () => {
    const marked = { "stop-a": { routeId: "route-1", at: "2026-09-29T15:00:00.000Z" } };

    expect(
      onTheWayView(A, {
        deliveries: [A],
        confirmed: marked,
        queue: [queuedFor("delivery-proof", "proof", "delivery-a")],
      }),
    ).toMatchObject({ current: false, offer: false });

    const occurrence = queuedFor("delivery-occurrence", "report-occurrence", "delivery-a", {
      occurrenceTypeId: "type-absent",
    });

    expect(
      onTheWayView(A, {
        deliveries: [A],
        confirmed: marked,
        queue: [occurrence],
        blockingTypeIds: new Set(["type-absent"]),
      }).current,
    ).toBe(false);

    expect(
      onTheWayView(A, { deliveries: [A], confirmed: marked, queue: [occurrence] }).current,
    ).toBe(true);
  });

  it("labels the state with the time, and says when it is only on the phone", () => {
    const clock = () => "15:02";

    expect(onTheWayLabel({ offer: false, current: true, since: "2026-09-29T15:02:00.000Z", queued: false }, clock)).toBe(
      "A caminho desde 15:02",
    );
    expect(onTheWayLabel({ offer: false, current: true, since: "2026-09-29T15:02:00.000Z", queued: true }, clock)).toBe(
      "A caminho desde 15:02 · salvo no aparelho",
    );
  });
});

describe("a refusal of a queued mark (the contract's error table)", () => {
  const mark = { id: "k1", ...queuedMark("stop-a", "2026-09-29T15:02:00.000Z") };

  it("the stop moved on: settled, nothing to show", () => {
    expect(onTheWayRefusalVerdict(mark, "ROUTE_STOP_NOT_PENDING", [mark])).toEqual({
      outcome: "settled",
      reason: "stop-not-pending",
    });
  });

  it("the route not on the street: settled, unless its departure waits ahead in the queue", () => {
    expect(onTheWayRefusalVerdict(mark, "ROUTE_NOT_IN_PROGRESS", [mark])).toEqual({
      outcome: "settled",
      reason: "route-not-in-progress",
    });

    const departure = {
      id: "d1",
      kind: "delivery-start-route",
      status: "pending",
      endpoint: "/route/start-route/route-1/business/business-1",
      body: {},
      createdAt: "2026-09-29T15:00:00.000Z",
    };

    expect(onTheWayRefusalVerdict(mark, "ROUTE_NOT_IN_PROGRESS", [departure, mark])).toEqual({
      outcome: "retry",
    });

    // Another route's departure does not help this mark.
    expect(
      onTheWayRefusalVerdict(mark, "ROUTE_NOT_IN_PROGRESS", [
        { ...departure, endpoint: "/route/start-route/route-9/business/business-1" },
        mark,
      ]),
    ).toMatchObject({ outcome: "settled" });
  });

  it("another driver's or another company's departure on this phone never holds the mark", () => {
    const mine = { ...mark, ownerUserId: "user-a", businessId: "business-1" };
    const departure = {
      id: "d1",
      kind: "delivery-start-route",
      status: "pending",
      ownerUserId: "user-a",
      businessId: "business-1",
      endpoint: "/route/start-route/route-1/business/business-1",
      body: {},
      createdAt: "2026-09-29T15:00:00.000Z",
    };

    expect(onTheWayRefusalVerdict(mine, "ROUTE_NOT_IN_PROGRESS", [departure, mine])).toEqual({
      outcome: "retry",
    });

    // A route reassigned on a shared phone: the other driver's departure is
    // never sent under this session, so waiting on it would be forever.
    expect(
      onTheWayRefusalVerdict(mine, "ROUTE_NOT_IN_PROGRESS", [
        { ...departure, ownerUserId: "user-b" },
        mine,
      ]),
    ).toEqual({ outcome: "settled", reason: "route-not-in-progress" });

    expect(
      onTheWayRefusalVerdict(mine, "ROUTE_NOT_IN_PROGRESS", [
        { ...departure, businessId: "business-2" },
        mine,
      ]),
    ).toEqual({ outcome: "settled", reason: "route-not-in-progress" });
  });

  it("the rest stays a visible failure", () => {
    for (const code of ["SUBMISSION_ID_REUSED", "ROUTE_STOP_NOT_FOUND", "PERMISSION_DENIED"]) {
      expect(onTheWayRefusalVerdict(mark, code, [mark]), code).toBeNull();
    }
  });
});

describe("the request", () => {
  it("names the stop and the route, and reads them back from a queued item", () => {
    const endpoint = onTheWayEndpoint("stop-1", "route-1", "business-1");

    expect(endpoint).toBe("/route/on-the-way/stop-1/route/route-1/business/business-1");
    expect(onTheWayTarget(endpoint)).toEqual({ stopId: "stop-1", routeId: "route-1" });
    expect(onTheWayTarget("/delivery/arrival/x/business/y")).toBeNull();
  });

  it("sends the position as a pair or not at all", () => {
    const base = {
      client_submission_id: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
      occurred_at: "2026-09-29T15:02:00.000Z",
    };

    expect(onTheWayBodySchema.safeParse(base).success).toBe(true);
    expect(onTheWayBodySchema.safeParse({ ...base, latitude: -15.6, longitude: -56.1 }).success).toBe(true);

    const half = onTheWayBodySchema.safeParse({ ...base, latitude: -15.6 });
    expect(half.success).toBe(false);
    expect(half.error?.issues[0]?.message).toBe(
      "Envie a latitude e a longitude juntas, ou nenhuma das duas.",
    );
  });

  it("keeps the instant the API answered, or nothing when the answer lacks it", () => {
    expect(confirmedOnTheWayAt({ data: { on_the_way_at: "2026-09-29T15:02:07.000Z" } })).toBe(
      "2026-09-29T15:02:07.000Z",
    );
    expect(confirmedOnTheWayAt({ message: "ok" })).toBeNull();
    expect(confirmedOnTheWayAt(null)).toBeNull();
  });
});

describe("the confirmed marks kept on the phone", () => {
  it("drop after a week and stay bounded, newest kept", () => {
    const now = Date.parse("2026-09-29T15:00:00.000Z");

    const marks = {
      old: { routeId: "r", at: "2026-09-20T15:00:00.000Z", storedAt: now - MARK_TTL_MS - 1 },
      fresh: { routeId: "r", at: "2026-09-29T14:00:00.000Z", storedAt: now - 1_000 },
    };

    expect(Object.keys(prunedMarks(marks, now))).toEqual(["fresh"]);

    const many = Object.fromEntries(
      Array.from({ length: MAX_MARKS_PER_SCOPE + 5 }, (_, index) => [
        `stop-${index}`,
        { routeId: "r", at: "2026-09-29T14:00:00.000Z", storedAt: now - index },
      ]),
    );

    const kept = prunedMarks(many, now);
    expect(Object.keys(kept)).toHaveLength(MAX_MARKS_PER_SCOPE);
    expect(kept["stop-0"]).toBeDefined();
    expect(kept[`stop-${MAX_MARKS_PER_SCOPE + 4}`]).toBeUndefined();
  });
});
