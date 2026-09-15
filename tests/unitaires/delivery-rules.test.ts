import { describe, expect, it } from "vitest";

import {
  activeRoute,
  canStartRoute,
  deliveryActions,
  formatDeliveryAddress,
  googleMapsUrl,
  groupDriverDeliveries,
  hasDeliveriesAccess,
  occurrenceNeedsPhoto,
  sortByRouteOrder,
  stopPosition,
  wazeUrl,
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

  it("offers the start-route button only while something is designated", () => {
    expect(canStartRoute(deliveries)).toBe(true);
    expect(canStartRoute([{ status: "IN_TRANSIT" }])).toBe(false);
    expect(canStartRoute([])).toBe(false);
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

    expect(activeRoute([{ id: "old-1", status: "PENDING" as const }])).toBeNull();
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

describe("which route the driver is working", () => {
  it("reads it off the deliveries themselves, with no second request", () => {
    // A phone with no signal cannot make one, and the payload already has it.
    const route = activeRoute([
      { id: "loose", status: "PENDING" as const },
      routed("a", 10),
    ]);

    expect(route?.code).toBe(42);
    expect(route?.name).toBe("Zona Sul");
  });

  it("answers null when nothing is on a route", () => {
    expect(
      activeRoute([{ id: "a", status: "PENDING" as const, stops: [] }]),
    ).toBeNull();
    expect(activeRoute([])).toBeNull();
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
