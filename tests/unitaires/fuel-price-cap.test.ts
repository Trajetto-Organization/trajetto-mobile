import { describe, expect, it } from "vitest";

import { MAX_PRICE_PER_LITER, nextPricePerLiterText } from "@/features/fuel/fuel-rules";
import { createFuelSchema } from "@/schemas/fuel";

/**
 * The price per litre (decision 15.9): more than zero, at most R$ 50,00,
 * mirrored by the API and the web. In the E2E run a driver typed "599" for
 * R$ 5,99 and the app saved R$ 599/L — the field had no limit.
 */
describe("nextPricePerLiterText", () => {
  it("formats what a driver types at the pump", () => {
    expect(nextPricePerLiterText("5")).toBe("R$ 5");
    expect(nextPricePerLiterText("R$ 5,8")).toBe("R$ 5,8");
    expect(nextPricePerLiterText("R$ 5,899")).toBe("R$ 5,899");
    expect(nextPricePerLiterText("5.89")).toBe("R$ 5,89");
    expect(nextPricePerLiterText("")).toBe("");
  });

  it("refuses a third digit before the comma", () => {
    // Red before: "599" was kept and saved as R$ 599/L.
    expect(nextPricePerLiterText("R$ 599")).toBeNull();
    expect(nextPricePerLiterText("R$ 100,5")).toBeNull();
    expect(nextPricePerLiterText("R$ 49")).toBe("R$ 49");
  });

  it("refuses a fourth decimal", () => {
    expect(nextPricePerLiterText("R$ 5,8999")).toBeNull();
  });
});

describe("createFuelSchema price_per_liter", () => {
  const base = {
    current_mileage: 1000,
    liters_amount: 40,
    refueling_date: "2026-10-06T10:00:00.000Z",
    vehicleId: "018f7e70-0000-7000-8000-0000000000e1",
    driverId: "018f7e70-0000-7000-8000-0000000000d1",
    fuelTypeId: "018f7e70-0000-7000-8000-0000000000f1",
    branchId: "018f7e70-0000-7000-8000-0000000000b1",
    businessId: "018f7e70-0000-7000-8000-00000000000a",
    latitude: -23.5,
    longitude: -46.6,
  };

  const priceIssues = (price: unknown) => {
    const result = createFuelSchema.safeParse({ ...base, price_per_liter: price });

    return result.success
      ? []
      : result.error.issues.filter((issue) => issue.path[0] === "price_per_liter").map((issue) => issue.message);
  };

  it("caps it at R$ 50,00", () => {
    expect(MAX_PRICE_PER_LITER).toBe(50);
    expect(priceIssues("R$ 50,00")).toEqual([]);
    expect(priceIssues(5.899)).toEqual([]);
    expect(priceIssues("R$ 50,001")).toEqual(["O preço por litro não pode exceder R$ 50,00."]);
    expect(priceIssues(599)).toEqual(["O preço por litro não pode exceder R$ 50,00."]);
  });

  it("refuses zero and negatives", () => {
    expect(priceIssues(0)).toEqual(["O preço por litro é obrigatório."]);
    expect(priceIssues(-1).length).toBeGreaterThan(0);
  });
});
