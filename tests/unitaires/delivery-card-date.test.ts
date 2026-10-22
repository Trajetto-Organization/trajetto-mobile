import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formatDateOnly } from "@/utils/formatters";

/**
 * The card's expected date is the day the dispatcher chose (decision 1.3).
 *
 * `Delivery.scheduled_date` is a date column: the API sends the civil day as
 * UTC midnight, "2026-09-17T00:00:00.000Z". The card formatted it with
 * `toLocaleDateString` in the phone's zone, and every phone in Brazil — three
 * to five hours behind UTC — showed "16/09" for a delivery of the 17th.
 *
 * The card cannot be rendered here, so its wiring is read, and the value it
 * shows is computed with the formatter it uses, in a Brazilian zone.
 */
const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const API_VALUE = "2026-09-17T00:00:00.000Z";

describe("the delivery card's date", () => {
  const card = readFileSync(
    resolve(__dirname, "../..", "components/screens/deliveries/delivery-card.tsx"),
    "utf8",
  );

  it("is formatted as a day, not as an instant in the phone's zone", () => {
    expect(card).toMatch(/formatDateOnly\(delivery\.scheduled_date\)/);
    expect(card).not.toMatch(/toLocaleDateString/);
  });

  it("shows the 17th for a delivery of the 17th, in Brazil", () => {
    // What the phone's zone made of it — the defect this replaces. The zone is
    // explicit: Node on Linux caches the default zone before beforeAll sets TZ.
    expect(
      new Date(API_VALUE).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "America/Sao_Paulo",
      }),
    ).toBe("16/09");

    expect(formatDateOnly(API_VALUE)).toBe("17/09");
    expect(formatDateOnly("2026-09-17")).toBe("17/09");
  });

  it("shows nothing rather than a wrong day when there is no date", () => {
    expect(formatDateOnly(null)).toBeNull();
    expect(formatDateOnly("not a date")).toBeNull();
  });
});
