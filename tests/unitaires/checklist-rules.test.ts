import { describe, expect, it } from "vitest";

import {
  getMissingAnswerFields,
  getMissingPhotoFields,
  getRequiredPhotoFields,
  isChecklistComplete,
  REQUIRED_CHECKLIST_FIELDS,
} from "@/features/checklist/checklist-rules";

import type { CreateChecklistFormData } from "@/schemas";

/**
 * A filled-in inspection where nothing is wrong. Individual tests break one
 * thing at a time, so what each one is actually asserting stays visible.
 */
const healthyChecklist = (): Partial<CreateChecklistFormData> => ({
  checklist_date: "2026-08-14T10:00:00.000Z",
  current_mileage: 120_000,
  tires_condition: "good",
  headlights_working: true,
  taillights_working: true,
  turn_signals_working: true,
  bumpers_condition: "good",
  windshield_condition: "good",
  mirrors_condition: "good",
  seatbelts_working: true,
  dashboard_working: true,
  steering_wheel_condition: "good",
  brakes_working: true,
  clutch_working: true,
  fuel_level_adequate: true,
  oil_level_adequate: true,
  radiator_water_adequate: true,
  brake_fluid_adequate: true,
  battery_condition: "good",
  driver_license_valid: true,
  vehicle_documents_valid: true,
  insurance_valid: true,
  fire_extinguisher_valid: true,
  warning_triangle_present: true,
  jack_present: true,
  spare_tire_condition: "good",
  overall_condition: "approved",
});

/** Photos for exactly the fields listed, one each. */
const photosFor = (fields: string[]): Record<string, { length: number }> =>
  Object.fromEntries(fields.map((field) => [field, { length: 1 }]));

const ALWAYS_REQUIRED = [
  "current_mileage",
  "fuel_level_adequate",
  "tires_condition",
];

describe("required photos", () => {
  it("always demands the three that form the legal record", () => {
    expect(getRequiredPhotoFields(healthyChecklist()).sort()).toEqual(
      [...ALWAYS_REQUIRED].sort(),
    );
  });

  it("demands evidence for a yes/no item answered no", () => {
    const values = { ...healthyChecklist(), brakes_working: false };

    expect(getRequiredPhotoFields(values)).toContain("brakes_working");
  });

  it("does not demand evidence for a yes/no item answered yes", () => {
    expect(getRequiredPhotoFields(healthyChecklist())).not.toContain(
      "brakes_working",
    );
  });

  it("demands evidence for a graded item below good", () => {
    const values = {
      ...healthyChecklist(),
      battery_condition: "needs_attention" as const,
    };

    expect(getRequiredPhotoFields(values)).toContain("battery_condition");
  });

  it("treats bad the same as needs_attention", () => {
    const values = { ...healthyChecklist(), mirrors_condition: "bad" as const };

    expect(getRequiredPhotoFields(values)).toContain("mirrors_condition");
  });

  /**
   * An unanswered item owes an answer, not a photo. Demanding a photo for a
   * question nobody has reached would light up half the form before the driver
   * has started.
   */
  it("demands nothing extra for an item not yet answered", () => {
    const values = { ...healthyChecklist() };
    delete values.brakes_working;
    delete values.battery_condition;

    const required = getRequiredPhotoFields(values);

    expect(required).not.toContain("brakes_working");
    expect(required).not.toContain("battery_condition");
  });

  it("lists a required photo that has not been attached", () => {
    const values = { ...healthyChecklist(), clutch_working: false };
    const photos = photosFor(ALWAYS_REQUIRED);

    expect(getMissingPhotoFields(values, photos)).toEqual(["clutch_working"]);
  });

  it("counts an empty array as no photo at all", () => {
    const photos = { ...photosFor(ALWAYS_REQUIRED), tires_condition: [] };

    expect(getMissingPhotoFields(healthyChecklist(), photos)).toEqual([
      "tires_condition",
    ]);
  });
});

describe("required answers", () => {
  it("accepts a fully answered checklist", () => {
    expect(getMissingAnswerFields(healthyChecklist())).toEqual([]);
  });

  it("reports every unanswered field", () => {
    const values = { ...healthyChecklist() };
    delete values.overall_condition;
    delete values.jack_present;

    expect(getMissingAnswerFields(values).sort()).toEqual([
      "jack_present",
      "overall_condition",
    ]);
  });

  /**
   * `false` is an answer — the most important one, since it is what triggers a
   * photo requirement. Treating it as blank would let a driver submit a truck
   * with failed brakes by simply saying so.
   */
  it("treats false as answered, not as blank", () => {
    const values = { ...healthyChecklist(), brakes_working: false };

    expect(getMissingAnswerFields(values)).toEqual([]);
  });

  it("guards every field the API requires", () => {
    expect(getMissingAnswerFields({}).sort()).toEqual(
      [...REQUIRED_CHECKLIST_FIELDS].sort(),
    );
  });
});

describe("checklist completeness", () => {
  const complete = {
    values: healthyChecklist(),
    photos: photosFor(ALWAYS_REQUIRED),
    isDriver: false,
    stepData: { branchId: "branch-1", driverId: "driver-1" },
  };

  it("accepts a checklist with every answer and every photo", () => {
    expect(isChecklistComplete(complete)).toBe(true);
  });

  it("refuses when a required photo is missing", () => {
    expect(
      isChecklistComplete({
        ...complete,
        values: { ...complete.values, oil_level_adequate: false },
      }),
    ).toBe(false);
  });

  it("refuses when an answer is missing", () => {
    const values = { ...complete.values };
    delete values.overall_condition;

    expect(isChecklistComplete({ ...complete, values })).toBe(false);
  });

  it("refuses a mileage of zero", () => {
    expect(
      isChecklistComplete({
        ...complete,
        values: { ...complete.values, current_mileage: 0 },
      }),
    ).toBe(false);
  });

  it("requires a branch and a driver from a manager", () => {
    expect(
      isChecklistComplete({ ...complete, stepData: { driverId: "driver-1" } }),
    ).toBe(false);
  });

  /**
   * A driver inherits the branch from the vehicle assignment and never sees a
   * chooser, so demanding one would make the form unsubmittable for them.
   */
  it("requires only the driver from a driver", () => {
    expect(
      isChecklistComplete({
        ...complete,
        isDriver: true,
        stepData: { driverId: "driver-1" },
      }),
    ).toBe(true);
  });

  it("refuses a driver with no driver id", () => {
    expect(
      isChecklistComplete({ ...complete, isDriver: true, stepData: {} }),
    ).toBe(false);
  });

  it("accepts a defect that was photographed", () => {
    expect(
      isChecklistComplete({
        ...complete,
        values: { ...complete.values, brakes_working: false },
        photos: photosFor([...ALWAYS_REQUIRED, "brakes_working"]),
      }),
    ).toBe(true);
  });
});
