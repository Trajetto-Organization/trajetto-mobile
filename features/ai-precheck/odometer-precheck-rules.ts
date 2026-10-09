import { compactText, fixDigitLookalikes, significantDigits } from "./ocr-text";

/**
 * The odometer pre-check (decision 14.2; design §P7.2): is the km the driver
 * typed on the photo of the odometer?
 *
 * `typed_mileage_found`:
 * - true: a digit run on the photo is the typed km, or the typed km followed
 *   by ONE tenths digit (the drum's last wheel);
 * - false: the photo shows at least one reading-sized number and none of
 *   them is the typed km — the driver may have mistyped;
 * - null: nothing on the photo can be told to be the odometer's reading.
 *
 * Conservative like the receipt: a run that could be the typed km missing a
 * digit (a drum read as 5671 for 56719, benchmark O03) is doubt, not "no".
 * The trip meter is never evidence: its line is skipped, so "TRIP 45210"
 * next to the odometer cannot confirm a typed 45210.
 */

interface OdometerCheck {
  typed_mileage_found: boolean | null;
}

const TRIP_LABEL = /TRIP/;

/** Digit runs of a line; a line of single spaced digits ("5 6 7 1 9") is one run. */
function digitRunsOf(line: string): string[] {
  const fixed = fixDigitLookalikes(line);
  const runs = (fixed.match(/\d+/g) ?? []).map((run) => significantDigits(run));

  if (/^\s*\d(?:\s+\d)+\s*$/.test(fixed)) {
    runs.push(significantDigits(fixed.replace(/\s/g, "")));
  }

  // "45.210" and "45,210": the thousands separator a display may print.
  for (const match of fixed.match(/\d{1,3}(?:[.,]\d{3})+/g) ?? []) {
    runs.push(significantDigits(match));
  }

  return runs.filter((run) => run.length > 0);
}

function checkOdometer(lines: string[], typedMileage: number | null | undefined): OdometerCheck {
  if (typeof typedMileage !== "number" || !Number.isFinite(typedMileage) || typedMileage <= 0) {
    return { typed_mileage_found: null };
  }

  const typed = String(Math.trunc(typedMileage));

  const runs = lines
    .filter((line) => !TRIP_LABEL.test(compactText(line)))
    .flatMap(digitRunsOf);

  const matches = (run: string) =>
    run === typed || (run.length === typed.length + 1 && run.startsWith(typed));

  if (runs.some(matches)) return { typed_mileage_found: true };

  // A reading-sized number that is not the typed km: worth a second look.
  const contradicts = runs.some((run) => run.length >= typed.length);

  if (contradicts) return { typed_mileage_found: false };

  return { typed_mileage_found: null };
}

export { checkOdometer };
export type { OdometerCheck };
