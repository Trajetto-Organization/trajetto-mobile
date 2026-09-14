import type { CreateChecklistFormData } from "@/schemas";

interface ChecklistDefaultsInput {
  vehicleId: string;
  businessId: string;
}

/**
 * The blank checklist.
 *
 * Every answer starts `undefined` rather than at a sensible-looking value, and
 * that is the point: an inspection item nobody looked at must be distinguishable
 * from one answered "fine". Defaulting these to `false` or `"good"` would let a
 * driver submit a form they never filled in, which is exactly the record the
 * company would later rely on.
 */
function buildChecklistDefaults({
  vehicleId,
  businessId,
}: ChecklistDefaultsInput): Partial<CreateChecklistFormData> {
  return {
    vehicleId,
    businessId,
    checklist_date: new Date().toISOString(),
    current_mileage: undefined,
    notes: "",
    branchId: "",
    driverId: "",

    // Yes/no items
    headlights_working: undefined,
    taillights_working: undefined,
    turn_signals_working: undefined,
    seatbelts_working: undefined,
    dashboard_working: undefined,
    brakes_working: undefined,
    clutch_working: undefined,
    fuel_level_adequate: undefined,
    oil_level_adequate: undefined,
    radiator_water_adequate: undefined,
    brake_fluid_adequate: undefined,
    driver_license_valid: undefined,
    vehicle_documents_valid: undefined,
    insurance_valid: undefined,
    fire_extinguisher_valid: undefined,
    warning_triangle_present: undefined,
    jack_present: undefined,

    // Graded items
    tires_condition: undefined,
    bumpers_condition: undefined,
    windshield_condition: undefined,
    mirrors_condition: undefined,
    steering_wheel_condition: undefined,
    battery_condition: undefined,
    spare_tire_condition: undefined,
    overall_condition: undefined,
  };
}

export { buildChecklistDefaults };
export type { ChecklistDefaultsInput };
