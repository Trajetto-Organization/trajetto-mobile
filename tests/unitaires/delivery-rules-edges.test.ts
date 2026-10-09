import { describe, expect, it } from "vitest";

import {
  DRIVER_DELIVERY_STATUS_LABELS,
  arrivalLabel,
  arrivalState,
  deliverySections,
  googleMapsUrl,
  headerRoute,
  queuedArrivalAt,
  routePlan,
  sectionTitle,
  sortByRouteOrder,
  stopPosition,
  wazeUrl,
  withStopArrived,
  type DriverRoute,
} from "@/features/deliveries/delivery-rules";

/**
 * Edges of the driver's list rules left alive by the 06/10 mutation run:
 * loose work mixed with routed work, stale cached route states, and the
 * fallbacks the navigation links take when the address is incomplete.
 */

type Status = "PENDING" | "IN_TRANSIT";

const route = (id: string, code: number, status: string, name: string | null = null): DriverRoute => ({
  id,
  code,
  name,
  status,
});

const routed = (id: string, r: DriverRoute, sequence: number, status: Status = "PENDING") => ({
  id,
  status,
  stops: [{ id: `stop-${id}`, sequence, status: "PENDING", route: r }],
});

const loose = (id: string, status: Status = "PENDING") => ({ id, status, stops: [] as never[] });

describe("sortByRouteOrder", () => {
  it("puts a routed delivery before loose work whichever comes first", () => {
    const r = route("r1", 1, "RELEASED");

    expect(sortByRouteOrder([loose("x"), routed("a", r, 10)]).map((d) => d.id)).toEqual(["a", "x"]);
    expect(sortByRouteOrder([routed("a", r, 10), loose("x")]).map((d) => d.id)).toEqual(["a", "x"]);
  });

  it("keeps loose work in the order it arrived", () => {
    const list = ["p", "q", "r", "s", "t"].map((id) => loose(id));

    expect(sortByRouteOrder(list).map((d) => d.id)).toEqual(["p", "q", "r", "s", "t"]);
  });
});

describe("stopPosition", () => {
  const r = route("r1", 1, "IN_PROGRESS");

  it("counts positions in a list that also holds loose work", () => {
    const a = routed("a", r, 10);
    const b = routed("b", r, 20);

    expect(stopPosition([loose("x"), a, b], b)).toBe(3);
  });

  it("is null when the delivery's stop is not in the list", () => {
    expect(stopPosition([routed("a", r, 10)], routed("b", r, 20))).toBeNull();
  });
});

describe("deliverySections", () => {
  it("orders routes by code with the loose work last, whatever the input order", () => {
    const r3 = route("r3", 3, "RELEASED");
    const r5 = route("r5", 5, "RELEASED");

    const sections = deliverySections([], [loose("x"), routed("a", r5, 10), routed("b", r3, 10)]);
    expect(sections.map((s) => s.key)).toEqual([
      "designated:r3",
      "designated:r5",
      "designated:loose",
    ]);

    const reversed = deliverySections([], [routed("b", r3, 10), loose("x"), routed("a", r5, 10)]);
    expect(reversed.map((s) => s.key)).toEqual([
      "designated:r3",
      "designated:r5",
      "designated:loose",
    ]);
  });

  it("offers no start and no notice on in-route sections", () => {
    const planned = route("r1", 1, "PLANNED");
    const sections = deliverySections(
      [loose("x", "IN_TRANSIT"), routed("a", planned, 10, "IN_TRANSIT")],
      [],
    );

    for (const section of sections) {
      expect(section.group).toBe("in-route");
      expect(section.start).toBeNull();
      expect(section.notice).toBeNull();
    }
    expect(sections.map((s) => s.key)).toEqual(["in-route:r1", "in-route:loose"]);
  });

  it("lets a released route start with no notice when nothing else runs", () => {
    const [section] = deliverySections([], [routed("a", route("r1", 1, "RELEASED"), 10)]);

    expect(section.notice).toBeNull();
    expect(section.start).toEqual({ routeId: "r1", routeCode: 1, count: 1 });
  });

  it("does not block a route on a stale copy of itself running", () => {
    // The cache can hold the same route twice: one delivery fetched before
    // the departure (RELEASED), another after it (IN_PROGRESS).
    const sections = deliverySections(
      [routed("a", route("r1", 1, "IN_PROGRESS"), 10, "IN_TRANSIT")],
      [routed("b", route("r1", 1, "RELEASED"), 20)],
    );
    const designated = sections.find((s) => s.group === "designated");

    expect(designated?.notice).toBeNull();
    expect(designated?.start).toEqual({ routeId: "r1", routeCode: 1, count: 1 });
  });
});

describe("headerRoute and sectionTitle", () => {
  it("names the one route even when loose work shares the day", () => {
    const r = route("r1", 42, "RELEASED", "Zona Sul");
    const sections = deliverySections([], [routed("a", r, 10), loose("x")]);

    expect(headerRoute(sections)).toEqual(r);
  });

  it("titles each group and place", () => {
    const named = deliverySections([routed("a", route("r1", 42, "IN_PROGRESS", "Zona Sul"), 10, "IN_TRANSIT")], []);
    expect(sectionTitle(named[0])).toBe("Em rota · Rota 42 · Zona Sul (1)");

    const unnamed = deliverySections([], [routed("a", route("r2", 7, "RELEASED"), 10)]);
    expect(sectionTitle(unnamed[0])).toBe("Designadas · Rota 7 (1)");

    const looseOnly = deliverySections([], [loose("x"), loose("y")]);
    expect(sectionTitle(looseOnly[0])).toBe("Designadas · sem rota (2)");
  });
});

describe("routePlan", () => {
  it("ignores a planned time that is not a string, even one Date.parse accepts", () => {
    const r = {
      ...route("r1", 1, "RELEASED"),
      // A foreign cached shape: Date.parse(0) is a valid date (year 2000).
      planned_departure_at: 0 as unknown as string,
    };

    expect(routePlan(r, () => "07:30")).toBeNull();
  });
});

describe("arrival", () => {
  it("only reads arrivals of this delivery's arrival kind", () => {
    const item = {
      kind: "delivery-on-the-way",
      status: "pending",
      endpoint: "/delivery/arrival/d1/s1",
      body: { occurred_at: "2026-10-06T10:00:00.000Z" },
      createdAt: "2026-10-06T10:00:05.000Z",
    };

    expect(queuedArrivalAt([item], "d1")).toBeNull();
  });

  it("falls back to the queue time when the tap time is not a string", () => {
    const item = {
      kind: "delivery-arrival",
      status: "pending",
      endpoint: "/delivery/arrival/d1/s1",
      body: { occurred_at: 123 },
      createdAt: "2026-10-06T10:00:05.000Z",
    };

    expect(queuedArrivalAt([item], "d1")).toBe("2026-10-06T10:00:05.000Z");
  });

  it("reports nothing queued when the driver has not arrived", () => {
    expect(arrivalState(loose("x"), null)).toEqual({ arrived: false, at: null, queued: false });
  });

  it("drops an unreadable arrival time from the label", () => {
    let called = false;
    const label = arrivalLabel({ arrived: true, at: "not-a-date", queued: false }, () => {
      called = true;
      return "??";
    });

    expect(label).toBe("Chegada registrada");
    expect(called).toBe(false);
  });

  it("does not rewrite a stop that already arrived", () => {
    const r = route("r1", 1, "IN_PROGRESS");
    const arrived = {
      id: "d1",
      status: "IN_TRANSIT" as const,
      stops: [{ id: "s1", sequence: 10, status: "ARRIVED", arrived_at: "2026-10-06T09:00:00.000Z", route: r }],
    };

    const [after] = withStopArrived([arrived], "d1", "2026-10-06T11:00:00.000Z");
    expect(after).toBe(arrived);
  });
});

describe("navigation links", () => {
  const address = {
    street: "Rua A",
    address_number: "100",
    city: "Campinas",
    uf: "SP",
    cep: "13000-000",
  };

  it("searches the full written address when there is no point", () => {
    expect(googleMapsUrl(address)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=" +
        encodeURIComponent("Rua A, 100, Campinas - SP, 13000-000"),
    );
  });

  it("leaves the number and the CEP empty when the address has none", () => {
    expect(wazeUrl({ street: "Rua A", city: "Campinas", uf: "SP" })).toBe(
      `https://waze.com/ul?q=${encodeURIComponent("Rua A, , Campinas - SP")}&navigate=yes`,
    );
  });

  it("needs both coordinates to use the point", () => {
    expect(wazeUrl({ ...address, latitude: -22.9, longitude: null })).toContain("?q=");
    expect(wazeUrl({ ...address, latitude: null, longitude: -47.06 })).toContain("?q=");
  });

  it("accepts the poles and the antimeridian, refuses past them", () => {
    expect(wazeUrl({ ...address, latitude: 90, longitude: 180 })).toBe(
      `https://waze.com/ul?ll=${encodeURIComponent("90,180")}&navigate=yes`,
    );
    expect(wazeUrl({ ...address, latitude: 10, longitude: 180.5 })).toContain("?q=");
    expect(wazeUrl({ ...address, latitude: 90.5, longitude: 10 })).toContain("?q=");
  });
});

describe("status labels", () => {
  it("speaks the driver's words for every status", () => {
    expect(DRIVER_DELIVERY_STATUS_LABELS).toEqual({
      PENDING: "Designada",
      IN_TRANSIT: "Em rota",
      DELIVERED: "Entregue",
      FAILED: "Insucesso",
      CANCELLED: "Cancelada",
    });
  });
});
