import { describe, expect, it } from "vitest";

import {
  calculateTotalAmount,
  getMissingEntryFields,
  getMissingSelections,
  isFuelComplete,
} from "@/features/fuel/fuel-rules";

const validEntries = () => ({
  refuelingDate: "2026-08-14T10:00:00.000Z",
  mileage: 120_000,
  liters: 45.5,
  pricePerLiter: 5.89,
});

const managerSelection = {
  branchId: "branch-1",
  driverId: "driver-1",
  fuelTypeId: "fuel-type-1",
};

describe("total amount", () => {
  it("multiplies litres by price", () => {
    expect(calculateTotalAmount(10, 5.5)).toBe(55);
  });

  /**
   * This number goes to the API and is reconciled against a receipt. Without
   * rounding, 45.5 × 5.89 lands on 267.99500000000006 and an expense report
   * grows a tail of digits nobody can explain.
   */
  it("rounds to two decimals", () => {
    expect(calculateTotalAmount(45.5, 5.89)).toBe(268);
    expect(calculateTotalAmount(33.33, 6.17)).toBe(205.65);
  });

  it("returns zero when either side is missing", () => {
    expect(calculateTotalAmount(undefined, 5.5)).toBe(0);
    expect(calculateTotalAmount(10, undefined)).toBe(0);
  });

  it("returns zero rather than a negative total", () => {
    expect(calculateTotalAmount(-10, 5.5)).toBe(0);
    expect(calculateTotalAmount(10, -5.5)).toBe(0);
  });
});

describe("required amounts", () => {
  it("accepts a fully filled refuelling", () => {
    expect(getMissingEntryFields(validEntries())).toEqual([]);
  });

  it("reports a missing date", () => {
    const entries = { ...validEntries(), refuelingDate: undefined };

    expect(getMissingEntryFields(entries)).toEqual(["refueling_date"]);
  });

  /**
   * Zero is not a reading, it is an untouched field. Accepting it would record
   * a refuelling of no litres against a vehicle at kilometre zero.
   */
  it("treats zero as missing, not as a value", () => {
    const entries = { ...validEntries(), liters: 0, mileage: 0 };

    expect(getMissingEntryFields(entries).sort()).toEqual([
      "current_mileage",
      "liters_amount",
    ]);
  });

  it("rejects a negative price", () => {
    const entries = { ...validEntries(), pricePerLiter: -1 };

    expect(getMissingEntryFields(entries)).toEqual(["price_per_liter"]);
  });
});

describe("required selections", () => {
  it("accepts a manager who chose all three", () => {
    expect(getMissingSelections(managerSelection, false)).toEqual([]);
  });

  it("reports what a manager has not chosen", () => {
    expect(getMissingSelections({ driverId: "driver-1" }, false).sort()).toEqual(
      ["branchId", "fuelTypeId"],
    );
  });

  /**
   * A driver inherits branch and fuel type from the vehicle assignment and
   * never sees those choosers, so demanding them would make the form
   * unsubmittable for exactly the person it is built for.
   */
  it("asks a driver only for the driver", () => {
    expect(getMissingSelections({ driverId: "driver-1" }, true)).toEqual([]);
  });

  it("still requires the driver id from a driver", () => {
    expect(getMissingSelections({}, true)).toEqual(["driverId"]);
  });
});

describe("refuelling completeness", () => {
  const complete = {
    selection: managerSelection,
    entries: validEntries(),
    isDriver: false,
    hasOdometerPhoto: true,
    hasLocation: true,
  };

  it("accepts a refuelling with everything in place", () => {
    expect(isFuelComplete(complete)).toBe(true);
  });

  /**
   * The odometer photo is the evidence the mileage claim rests on. A refuelling
   * without it is a number nobody can check later.
   */
  it("refuses without the odometer photo", () => {
    expect(isFuelComplete({ ...complete, hasOdometerPhoto: false })).toBe(false);
  });

  it("refuses without a location", () => {
    expect(isFuelComplete({ ...complete, hasLocation: false })).toBe(false);
  });

  it("refuses when an amount is missing", () => {
    expect(
      isFuelComplete({
        ...complete,
        entries: { ...complete.entries, liters: undefined },
      }),
    ).toBe(false);
  });

  it("refuses when a manager has not chosen a branch", () => {
    expect(
      isFuelComplete({
        ...complete,
        selection: { driverId: "driver-1", fuelTypeId: "fuel-type-1" },
      }),
    ).toBe(false);
  });

  it("accepts a driver who only picked themselves", () => {
    expect(
      isFuelComplete({
        ...complete,
        isDriver: true,
        selection: { driverId: "driver-1" },
      }),
    ).toBe(true);
  });
});
