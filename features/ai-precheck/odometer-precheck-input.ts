/**
 * The km the odometer pre-check compares with, from what the form holds.
 * Pure: the fuel and checklist forms keep the km as a number or as the text
 * being typed ("45.210"), and a check against half a number is noise.
 */
function typedMileageOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;

  if (typeof value !== "string" || value.trim() === "") return null;

  const parsed = Number.parseFloat(value.replace(/\./g, "").replace(",", "."));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** How long the km must stay still before the photo is checked against it. */
const MILEAGE_DEBOUNCE_MS = 800;

export { MILEAGE_DEBOUNCE_MS, typedMileageOf };
