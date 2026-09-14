import type { CreateFuelFormData } from "@/schemas";

interface FuelDefaultsInput {
  vehicleId: string;
  businessId: string;
}

/**
 * The blank refuelling.
 *
 * The amounts start `undefined` rather than at zero so an untouched field reads
 * as empty instead of as a deliberate `0` — the form treats zero as invalid,
 * and pre-filling it would show a validation error before the driver has typed
 * anything. The coordinates start empty on purpose too: a position is captured
 * per refuelling and never carried over from a previous one.
 */
function buildFuelDefaults({
  vehicleId,
  businessId,
}: FuelDefaultsInput): Partial<CreateFuelFormData> {
  return {
    vehicleId,
    businessId,
    refueling_date: new Date().toISOString(),
    current_mileage: undefined,
    liters_amount: undefined,
    price_per_liter: undefined,
    total_amount: undefined,
    notes: "",
    branchId: "",
    driverId: "",
    fuelTypeId: "",
    latitude: undefined,
    longitude: undefined,
  };
}

export { buildFuelDefaults };
export type { FuelDefaultsInput };
