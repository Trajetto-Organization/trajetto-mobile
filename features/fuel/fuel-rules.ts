/**
 * When a refuelling counts as filled in, and what it costs.
 *
 * Pure functions on purpose: these are the rules the company bills against, and
 * they were previously spread across a hook where nobody could read them
 * without also reading React. Nothing here touches state, so it can be tested
 * and — more importantly — argued about.
 *
 * The API enforces the same requirements. This is the copy that lets the app
 * tell a driver what is missing before they drive away from the pump.
 */

import { formatCurrency } from "@/utils/formatters";

interface FuelSelection {
  branchId?: string;
  driverId?: string;
  fuelTypeId?: string;
}

interface FuelEntries {
  refuelingDate?: string;
  mileage?: number;
  liters?: number;
  pricePerLiter?: number;
}

interface FuelCompletenessInput {
  selection: FuelSelection;
  entries: FuelEntries;

  /** A driver inherits branch and fuel type from the vehicle assignment. */
  isDriver: boolean;

  hasOdometerPhoto: boolean;
  hasLocation: boolean;
}

/**
 * What the refuelling cost, to two decimals.
 *
 * Rounded here rather than left to the renderer because this number is sent to
 * the API and reconciled against the receipt: floating point would otherwise
 * put `41.870000000000005` on an expense report.
 */
function calculateTotalAmount(liters?: number, pricePerLiter?: number): number {
  if (!liters || !pricePerLiter) return 0;
  if (liters <= 0 || pricePerLiter <= 0) return 0;

  return Math.round(liters * pricePerLiter * 100) / 100;
}

/** Amounts that must be present and above zero. */
function getMissingEntryFields(entries: FuelEntries): string[] {
  const missing: string[] = [];

  if (!entries.refuelingDate) missing.push("refueling_date");

  // Zero is as invalid as absent: a refuelling of no litres is not a record,
  // it is a mistake, and the API rejects it either way.
  if (!entries.mileage || entries.mileage <= 0) missing.push("current_mileage");
  if (!entries.liters || entries.liters <= 0) missing.push("liters_amount");

  if (!entries.pricePerLiter || entries.pricePerLiter <= 0) {
    missing.push("price_per_liter");
  }

  return missing;
}

/** Selections the driver still has to make. */
function getMissingSelections(
  selection: FuelSelection,
  isDriver: boolean,
): string[] {
  const missing: string[] = [];

  if (!selection.driverId) missing.push("driverId");
  if (isDriver) return missing;

  if (!selection.branchId) missing.push("branchId");
  if (!selection.fuelTypeId) missing.push("fuelTypeId");

  return missing;
}

/**
 * Whether the submit button should be enabled.
 *
 * The photo and the GPS position are as required as the numbers: an odometer
 * reading with no picture of the odometer, or a refuelling with no location,
 * is a record nobody can audit later.
 */
function isFuelComplete({
  selection,
  entries,
  isDriver,
  hasOdometerPhoto,
  hasLocation,
}: FuelCompletenessInput): boolean {
  if (getMissingSelections(selection, isDriver).length > 0) return false;
  if (getMissingEntryFields(entries).length > 0) return false;

  return hasOdometerPhoto && hasLocation;
}

/**
 * The form's fields in screen order (decision 16.700): a failed submit
 * brings the first invalid one into view. `odometer_photo` is the photo
 * area, which lives outside the react-hook-form values.
 */
const FUEL_FORM_FIELDS = [
  "refueling_date",
  "current_mileage",
  "liters_amount",
  "price_per_liter",
  "odometer_photo",
  "latitude",
  "longitude",
  "notes",
] as const;

const ODOMETER_PHOTO_REQUIRED = "Adicione a foto do odômetro.";

/**
 * What the schema cannot see: the photo is a file, not a form value. Shown
 * like any other field's message — under the photo area — instead of a toast
 * after the tap.
 */
function fuelAttachmentIssues({
  hasOdometerPhoto,
}: {
  hasOdometerPhoto: boolean;
}): Record<"odometer_photo", string | null> {
  return { odometer_photo: hasOdometerPhoto ? null : ODOMETER_PHOTO_REQUIRED };
}

/** The highest price per litre accepted (decision 15.9), as the API and web. */
const MAX_PRICE_PER_LITER = 50;

/**
 * The price field's text after a keystroke, or null to keep the previous one.
 *
 * At most two digits before the comma: no fuel costs R$ 100/L or more, and a
 * driver typing "599" for R$ 5,99 had it saved as R$ 599/L. At most three
 * after it, as pumps price fuel (R$ 5,899); a fourth would be rounded away.
 */
function nextPricePerLiterText(typed: string): string | null {
  const formatted = formatCurrency(typed);
  const digits = formatted.replace(/^R\$\s*/, "");
  const separator = Math.max(typed.lastIndexOf(","), typed.lastIndexOf("."));

  if (separator !== -1 && typed.slice(separator + 1).replace(/\D/g, "").length > 3) {
    return null;
  }

  const [integer = ""] = digits.split(",");

  if (integer.replace(/^0+(?=\d)/, "").length > 2) return null;

  return formatted;
}

export {
  FUEL_FORM_FIELDS,
  MAX_PRICE_PER_LITER,
  ODOMETER_PHOTO_REQUIRED,
  fuelAttachmentIssues,
  calculateTotalAmount,
  getMissingEntryFields,
  getMissingSelections,
  isFuelComplete,
  nextPricePerLiterText,
};

export type { FuelCompletenessInput, FuelEntries, FuelSelection };
