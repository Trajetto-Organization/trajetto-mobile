import { describe, expect, it } from "vitest";

import {
  arrivalLabel,
  arrivalState,
  deliveryActions,
  deliverySections,
  formatDeliveryAddress,
  googleMapsUrl,
  groupDriverDeliveries,
  hasDeliveriesAccess,
  headerRoute,
  occurrenceNeedsPhoto,
  queuedArrivalAt,
  routePlan,
  sectionTitle,
  sortByRouteOrder,
  startRouteLabel,
  stopPosition,
  wazeUrl,
  withStopArrived,
} from "@/features/deliveries/delivery-rules";

describe("deliveries access", () => {
  it("only exists for a driver with the module enabled", () => {
    expect(
      hasDeliveriesAccess({
        driverId: "driver-1",
        enabledModules: ["FLEET", "DELIVERIES"],
      }),
    ).toBe(true);

    // A manager of the same business is not a driver.
    expect(
      hasDeliveriesAccess({ driverId: null, enabledModules: ["DELIVERIES"] }),
    ).toBe(false);

    // A driver whose business turned the module off.
    expect(
      hasDeliveriesAccess({ driverId: "driver-1", enabledModules: ["FLEET"] }),
    ).toBe(false);

    // Sessions from before the field existed carry no list at all.
    expect(hasDeliveriesAccess({ driverId: "driver-1" })).toBe(false);
    expect(hasDeliveriesAccess(null)).toBe(false);
  });
});

describe("the day's list", () => {
  const deliveries = [
    { id: "a", status: "PENDING" as const },
    { id: "b", status: "IN_TRANSIT" as const },
    { id: "c", status: "PENDING" as const },
  ];

  it("groups designated apart from in-route", () => {
    const groups = groupDriverDeliveries(deliveries);

    expect(groups.designated.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(groups.inRoute.map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("what each status offers", () => {
  it("everything operational waits for the route to start", () => {
    expect(deliveryActions("PENDING")).toEqual({
      canArrive: false,
      canProve: false,
      canReportOccurrence: false,
    });

    expect(deliveryActions("IN_TRANSIT")).toEqual({
      canArrive: true,
      canProve: true,
      canReportOccurrence: true,
    });
  });

  it("terminal statuses offer nothing", () => {
    for (const status of ["DELIVERED", "CANCELLED", "FAILED"] as const) {
      const actions = deliveryActions(status);

      expect(actions.canArrive).toBe(false);
      expect(actions.canProve).toBe(false);
      expect(actions.canReportOccurrence).toBe(false);
    }
  });
});

describe("occurrence photo requirement", () => {
  it("blocks a bare report only when the type demands a photo", () => {
    expect(occurrenceNeedsPhoto({ requires_photo: true }, 0)).toBe(true);
    expect(occurrenceNeedsPhoto({ requires_photo: true }, 1)).toBe(false);
    expect(occurrenceNeedsPhoto({ requires_photo: false }, 0)).toBe(false);
    expect(occurrenceNeedsPhoto({}, 0)).toBe(false);
  });
});

describe("address and navigation deep-links", () => {
  const address = {
    street: "Rua das Laranjeiras",
    address_number: "120",
    neighborhood: "Centro",
    city: "Petrópolis",
    uf: "RJ",
    cep: "25680-000",
  };

  it("formats the address the way the card shows it", () => {
    expect(formatDeliveryAddress(address)).toBe(
      "Rua das Laranjeiras, 120 — Centro · Petrópolis/RJ",
    );

    expect(
      formatDeliveryAddress({
        street: "Estrada Velha",
        city: "Areal",
        uf: "RJ",
      }),
    ).toBe("Estrada Velha · Areal/RJ");
  });

  it("builds plain deep-links — no API key anywhere", () => {
    const maps = googleMapsUrl(address);
    const waze = wazeUrl(address);

    expect(maps).toContain(
      "https://www.google.com/maps/dir/?api=1&destination=",
    );
    expect(maps).toContain(encodeURIComponent("Rua das Laranjeiras"));
    expect(maps).toContain(encodeURIComponent("Petrópolis - RJ"));

    expect(waze).toContain("https://waze.com/ul?q=");
    expect(waze).toContain("&navigate=yes");

    // The whole point of the deep-link decision: never a key, never billing.
    expect(maps).not.toContain("key=");
    expect(waze).not.toContain("key=");
  });

  it("prefers the delivery's point when it has one (route design §6.6)", () => {
    const pinned = { ...address, latitude: -22.5051, longitude: -43.1789 };

    expect(googleMapsUrl(pinned)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-22.5051%2C-43.1789",
    );
    expect(wazeUrl(pinned)).toBe(
      "https://waze.com/ul?ll=-22.5051%2C-43.1789&navigate=yes",
    );
  });

  it("falls back to the written address without a usable point", () => {
    for (const point of [
      { latitude: null, longitude: null },
      { latitude: -22.5, longitude: null },
      { latitude: 120, longitude: -43.1 },
      { latitude: Number.NaN, longitude: -43.1 },
    ]) {
      expect(googleMapsUrl({ ...address, ...point })).toBe(googleMapsUrl(address));
      expect(wazeUrl({ ...address, ...point })).toBe(wazeUrl(address));
    }
  });
});

/**
 * The order the dispatcher chose, on the phone.
 *
 * Until now the driver worked the day in whatever order the server happened to
 * send — by date, then by creation — while the dispatcher had carefully
 * dragged the addresses into the sequence that makes the street work. The
 * sequence now travels with each delivery, and this is what reads it.
 *
 * Sorting happens on the app and not on the server for a reason worth keeping
 * in mind while reading these: this list renders from the seven-day offline
 * cache, where whatever order the server sent is long gone.
 */
function routed(
  id: string,
  sequence: number,
  status: "PENDING" | "IN_TRANSIT" = "PENDING",
) {
  return {
    id,
    status,
    stops: [
      {
        id: `stop-${id}`,
        sequence,
        status: "PENDING",
        route: { id: "route-1", code: 42, name: "Zona Sul", status: "RELEASED" },
      },
    ],
  };
}

describe("the street, in the order the dispatcher chose", () => {
  it("sorts by the stop sequence, not by the order it arrived in", () => {
    const list = [routed("c", 30), routed("a", 10), routed("b", 20)];

    expect(sortByRouteOrder(list).map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("puts work with no route after the route, in the order it came", () => {
    // Batch-assigned deliveries have no street order to respect. Putting them
    // first would bury the route the driver is actually running.
    const list = [
      { id: "loose-1", status: "PENDING" as const },
      routed("b", 20),
      { id: "loose-2", status: "PENDING" as const },
      routed("a", 10),
    ];

    expect(sortByRouteOrder(list).map((entry) => entry.id)).toEqual([
      "a",
      "b",
      "loose-1",
      "loose-2",
    ]);
  });

  it("leaves a list with no routes exactly as it was", () => {
    // The operations that never adopted routes must see no change at all.
    const list = [
      { id: "a", status: "PENDING" as const, stops: [] },
      { id: "b", status: "PENDING" as const, stops: [] },
    ];

    expect(sortByRouteOrder(list).map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("survives rows cached before the field existed", () => {
    // The app renders from up to seven days of cached payloads, and the ones
    // written before this release carry no `stops` key at all. Reading
    // `stops[0]` on them must not be a crash on a screen someone is using in
    // the street.
    const list = [
      { id: "old-1", status: "PENDING" as const },
      routed("new", 10),
      { id: "old-2", status: "PENDING" as const },
    ];

    expect(sortByRouteOrder(list).map((entry) => entry.id)).toEqual([
      "new",
      "old-1",
      "old-2",
    ]);

    expect(
      deliverySections([], [{ id: "old-1", status: "PENDING" as const }])[0]
        .route,
    ).toBeNull();
  });

  it("does not mutate the list it was given", () => {
    const list = [routed("b", 20), routed("a", 10)];
    const before = list.map((entry) => entry.id);

    sortByRouteOrder(list);

    expect(list.map((entry) => entry.id)).toEqual(before);
  });

  it("orders both groups of the day's list", () => {
    const groups = groupDriverDeliveries([
      routed("second", 20),
      routed("first", 10),
      routed("running-second", 20, "IN_TRANSIT"),
      routed("running-first", 10, "IN_TRANSIT"),
    ]);

    expect(groups.designated.map((entry) => entry.id)).toEqual([
      "first",
      "second",
    ]);
    expect(groups.inRoute.map((entry) => entry.id)).toEqual([
      "running-first",
      "running-second",
    ]);
  });
});

describe("which address this is", () => {
  it("counts positions, not stored sequences", () => {
    // Sequences are spaced by ten so the dispatcher can drop a stop between
    // two others cheaply. Telling a driver they are at address "20" of a
    // three-stop route would be nonsense.
    const ordered = sortByRouteOrder([
      routed("a", 10),
      routed("b", 20),
      routed("c", 30),
    ]);

    expect(stopPosition(ordered, ordered[0])).toBe(1);
    expect(stopPosition(ordered, ordered[1])).toBe(2);
    expect(stopPosition(ordered, ordered[2])).toBe(3);
  });

  it("answers null for a delivery that is not on a route", () => {
    const loose = { id: "loose", status: "PENDING" as const, stops: [] };

    expect(stopPosition([loose], loose)).toBeNull();
  });
});

/**
 * "Iniciar rota" with more than one route in the day (MOB-04).
 *
 * Each assignment creates its own route, so a driver already on the street
 * can be handed a second one. The screen used to read "the" route off the
 * first delivery it found — the running one — and its single button posted
 * the departure there: the API answered the resend as success, the phone
 * said "Rota iniciada!", and the new deliveries stayed Designadas.
 */
function onRoute(
  id: string,
  sequence: number,
  route: { id: string; code: number; status: string; name?: string | null },
  status: "PENDING" | "IN_TRANSIT" = "PENDING",
) {
  return {
    id,
    status,
    stops: [
      {
        id: `stop-${id}`,
        sequence,
        status: "PENDING",
        route: { name: null, ...route },
      },
    ],
  };
}

const RUNNING = { id: "route-running", code: 41, status: "IN_PROGRESS" };
const RELEASED = { id: "route-new", code: 42, status: "RELEASED" };
const ANOTHER = { id: "route-other", code: 43, status: "RELEASED" };

const BUSY_NOTICE =
  "Você já está com a Rota 41 em andamento. Conclua essa rota (ou peça ao despachante para cancelá-la) antes de iniciar outra.";

describe("the day's list, one section per route", () => {
  it("offers no departure for a new route while another is on the street", () => {
    // The API refuses it (409 ROUTE_DRIVER_BUSY, FLEET-ASSIGN-3): the button
    // used to queue a start that could only be refused.
    const inRoute = [onRoute("a", 10, RUNNING, "IN_TRANSIT")];
    const designated = [onRoute("b", 10, RELEASED), onRoute("c", 20, RELEASED)];

    const sections = deliverySections(inRoute, designated);

    // The running route shows its deliveries and offers no departure.
    const running = sections.find((section) => section.group === "in-route");
    expect(running?.route?.id).toBe("route-running");
    expect(running?.start).toBeNull();

    // The new route is listed, says why it waits, and has no button.
    const waiting = sections.find((section) => section.route?.id === "route-new");
    expect(waiting?.deliveries.map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(waiting?.start).toBeNull();
    expect(waiting?.notice).toBe(BUSY_NOTICE);

    expect(sections.some((section) => section.start)).toBe(false);
  });

  it("knows a route is running from designated work on it too", () => {
    // Deliveries added to a route after it left stay designated on it.
    const sections = deliverySections(
      [],
      [onRoute("late", 10, RUNNING), onRoute("b", 10, RELEASED)],
    );

    const waiting = sections.find((section) => section.route?.id === "route-new");
    expect(waiting?.start).toBeNull();
    expect(waiting?.notice).toBe(BUSY_NOTICE);
  });

  it("keeps the loose work startable while a route runs (its departure is not refused)", () => {
    const sections = deliverySections(
      [onRoute("a", 10, RUNNING, "IN_TRANSIT")],
      // Served with an empty `stops` when the delivery is on no route.
      [{ id: "loose", status: "PENDING" as const, stops: [] }],
    );

    const loose = sections.find((section) => section.route === null);
    expect(loose?.start).toEqual({ routeId: null, routeCode: null, count: 1 });
    expect(loose?.notice).toBeNull();
  });

  it("offers the new route's departure once nothing is on the street", () => {
    const sections = deliverySections(
      [],
      [onRoute("b", 10, RELEASED), onRoute("c", 20, RELEASED)],
    );

    const starts = sections.flatMap((section) =>
      section.start ? [section.start] : [],
    );

    expect(starts).toEqual([
      { routeId: "route-new", routeCode: 42, count: 2 },
    ]);
  });

  it("gives each released route its own section and button", () => {
    const sections = deliverySections(
      [],
      [
        onRoute("x", 10, ANOTHER),
        onRoute("b", 20, RELEASED),
        onRoute("a", 10, RELEASED),
      ],
    );

    expect(sections.map((section) => section.route?.code)).toEqual([42, 43]);
    expect(sections[0].deliveries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(sections.map((section) => section.start?.routeId)).toEqual([
      "route-new",
      "route-other",
    ]);
  });

  it("keeps the work with no route apart, last, on the legacy departure", () => {
    const sections = deliverySections(
      [],
      [
        { id: "loose", status: "PENDING" as const },
        onRoute("a", 10, RELEASED),
      ],
    );

    expect(sections.map((section) => section.route?.id ?? null)).toEqual([
      "route-new",
      null,
    ]);

    const loose = sections[1];
    expect(loose.start).toEqual({ routeId: null, routeCode: null, count: 1 });
    expect(startRouteLabel(loose.start!)).toBe(
      "Iniciar entregas sem rota (1 entrega)",
    );
  });

  it("offers no departure where pressing it would move nothing", () => {
    const planned = { id: "route-planned", code: 44, status: "PLANNED" };

    const sections = deliverySections(
      [],
      [onRoute("p", 10, planned), onRoute("late", 10, RUNNING)],
    );

    // A planned route cannot leave (the API moves only RELEASED), and a
    // running route already took its deliveries along.
    expect(sections.every((section) => section.start === null)).toBe(true);
    expect(sections.map((section) => section.notice)).toEqual([
      "Esta rota já está em andamento. Fale com o despachante para incluir estas entregas.",
      "Rota ainda não liberada pelo despachante.",
    ]);
  });

  it("has nothing to start when nothing is designated", () => {
    const sections = deliverySections(
      [onRoute("a", 10, RUNNING, "IN_TRANSIT")],
      [],
    );

    expect(sections.some((section) => section.start)).toBe(false);
    expect(deliverySections([], [])).toEqual([]);
  });

  it("names the route in the header only when the day has exactly one", () => {
    const one = deliverySections(
      [onRoute("a", 10, RUNNING, "IN_TRANSIT")],
      [onRoute("b", 20, RUNNING)],
    );
    expect(headerRoute(one)?.code).toBe(41);

    const two = deliverySections(
      [onRoute("a", 10, RUNNING, "IN_TRANSIT")],
      [onRoute("b", 10, RELEASED)],
    );
    expect(headerRoute(two)).toBeNull();
  });

  it("titles and labels each section in the driver's words", () => {
    const [section] = deliverySections(
      [],
      [
        onRoute("a", 10, { ...RELEASED, name: "Zona Sul" }),
        onRoute("b", 20, { ...RELEASED, name: "Zona Sul" }),
      ],
    );

    expect(sectionTitle(section)).toBe("Designadas · Rota 42 · Zona Sul (2)");
    expect(startRouteLabel(section.start!)).toBe(
      "Iniciar rota 42 (2 entregas)",
    );
  });
});

/**
 * "Cheguei" after the arrival (MOB-19).
 *
 * The API accepts more than one arrival — a redelivery arrives again — so a
 * second tap wrote a second ARRIVAL for the same visit.
 */
describe("whether the driver already arrived", () => {
  const TAPPED = "2026-09-28T14:05:00.000Z";

  const withStop = (status: string, arrivedAt?: string | null) => ({
    id: "d-1",
    status: "IN_TRANSIT" as const,
    stops: [
      {
        id: "stop-1",
        sequence: 10,
        status,
        arrived_at: arrivedAt,
        route: { id: "r-1", code: 1, name: null, status: "IN_PROGRESS" },
      },
    ],
  });

  const arrivalItem = (overrides: Record<string, unknown> = {}) => ({
    kind: "delivery-arrival",
    status: "pending",
    endpoint: "/delivery/arrival/d-1/business/b-1",
    body: { occurred_at: TAPPED },
    createdAt: "2026-09-28T14:05:01.000Z",
    ...overrides,
  });

  it("reads the stop the server marked ARRIVED", () => {
    expect(arrivalState(withStop("ARRIVED", TAPPED), null)).toEqual({
      arrived: true,
      at: TAPPED,
      queued: false,
    });

    // A payload cached before arrived_at was served: arrived, time unknown.
    const state = arrivalState(withStop("ARRIVED"), null);
    expect(state.arrived).toBe(true);
    expect(arrivalLabel(state)).toBe("Chegada registrada");
  });

  it("counts an arrival still waiting in the queue", () => {
    const queued = queuedArrivalAt([arrivalItem()], "d-1");

    expect(queued).toBe(TAPPED);
    expect(arrivalState(withStop("PENDING"), queued)).toEqual({
      arrived: true,
      at: TAPPED,
      queued: true,
    });
    expect(
      arrivalLabel(arrivalState(withStop("PENDING"), queued), () => "11:05"),
    ).toBe("Chegada salva no aparelho às 11:05");
  });

  it("does not count a failed one, another delivery's, or another kind", () => {
    expect(
      queuedArrivalAt([arrivalItem({ status: "failed" })], "d-1"),
    ).toBeNull();
    expect(queuedArrivalAt([arrivalItem()], "d-10")).toBeNull();
    expect(
      queuedArrivalAt(
        [
          arrivalItem({
            kind: "delivery-proof",
            endpoint: "/delivery/proof/d-1/business/b-1",
          }),
        ],
        "d-1",
      ),
    ).toBeNull();
  });

  it("leaves 'Cheguei' available before any arrival", () => {
    expect(arrivalState(withStop("PENDING"), null).arrived).toBe(false);
    const loose = { id: "loose", status: "IN_TRANSIT" as const, stops: [] };

    expect(arrivalState(loose, null).arrived).toBe(false);
  });

  it("marks the cached stop ARRIVED right after the tap", () => {
    const list = [withStop("PENDING"), { ...withStop("PENDING"), id: "d-2" }];

    const marked = withStopArrived(list, "d-1", TAPPED);

    expect(marked[0].stops?.[0]).toMatchObject({
      status: "ARRIVED",
      arrived_at: TAPPED,
    });
    expect(marked[1]).toBe(list[1]);
    expect(arrivalLabel(arrivalState(marked[0], null), () => "11:05")).toBe(
      "Chegada registrada às 11:05",
    );
  });
});

/**
 * The route's destination and planned window in the list (decision 6.5,
 * DLVP-ROUTE-1). The dispatcher now fills them; the app shows whatever of
 * them the payload carries and nothing when it carries none (older API or a
 * cached day).
 */
describe("the route's plan under its title", () => {
  const clock = (iso: string) => iso.slice(11, 16);
  const base = { id: "r-1", code: 7, name: null, status: "RELEASED" };

  it("says where the route goes and when it leaves and comes back", () => {
    expect(
      routePlan(
        {
          ...base,
          destination: "  CD Campinas ",
          planned_departure_at: "2026-09-29T07:30:00.000Z",
          planned_arrival_at: "2026-09-29T18:00:00.000Z",
        },
        clock,
      ),
    ).toBe("Destino: CD Campinas · Saída prevista 07:30 · Retorno previsto 18:00");
  });

  it("shows only what the route has", () => {
    expect(routePlan({ ...base, destination: "Zona Sul" }, clock)).toBe(
      "Destino: Zona Sul",
    );
    expect(
      routePlan({ ...base, planned_departure_at: "2026-09-29T07:30:00.000Z" }, clock),
    ).toBe("Saída prevista 07:30");
  });

  it("says nothing without a plan, or with values it cannot read", () => {
    expect(routePlan(base, clock)).toBeNull();
    expect(
      routePlan(
        { ...base, destination: "   ", planned_departure_at: "amanhã", planned_arrival_at: null },
        clock,
      ),
    ).toBeNull();
  });

  it("shows the times on the phone's clock by default", () => {
    const departure = "2026-09-29T11:30:00.000Z";
    const local = new Date(departure);
    const pad = (value: number) => String(value).padStart(2, "0");

    // The phone's local hours (Date follows the process zone), not the UTC
    // digits of the ISO string.
    expect(routePlan({ ...base, planned_departure_at: departure })).toBe(
      `Saída prevista ${pad(local.getHours())}:${pad(local.getMinutes())}`,
    );
  });
});
