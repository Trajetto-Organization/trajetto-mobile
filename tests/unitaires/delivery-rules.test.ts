import { describe, expect, it } from "vitest";

import {
  canStartRoute,
  deliveryActions,
  formatDeliveryAddress,
  googleMapsUrl,
  groupDriverDeliveries,
  hasDeliveriesAccess,
  occurrenceNeedsPhoto,
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
