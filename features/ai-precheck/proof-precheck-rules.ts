import {
  compactText,
  normalizeText,
  numberCandidates,
  significantDigits,
} from "./ocr-text";

/**
 * The receipt pre-check (decision 14.2; design §P7.2): does the photo look
 * like THIS delivery's receipt?
 *
 * Two questions, each answerable as "yes", "no" or "cannot say" (null):
 *
 * - `invoice_number_found`: the delivery's invoice number appears on the
 *   photo, printed with or without dots, spaces and leading zeros, or inside
 *   the 44-digit access key (where the number sits at a fixed position).
 * - `date_out_of_window`: the RECEIVING date legible on the photo is not the
 *   business day of the proof. Only the receiving date counts: the printed
 *   emission date is earlier by nature and would warn on every receipt.
 *
 * Conservative by design — a warning the driver learns to ignore is worse
 * than no warning — so doubt is null, and null never warns.
 */

interface ProofCheckInput {
  /** The delivery's invoice number as the app has it; null = nothing to compare. */
  invoiceNumber: string | null | undefined;

  /** The business day of the proof, "YYYY-MM-DD" (`businessDayOf`). */
  businessDay: string;
}

interface ProofCheck {
  invoice_number_found: boolean | null;
  date_out_of_window: boolean | null;
}

/** The access key: 44 digits, the invoice number at positions 26–34 (nNF). */
const ACCESS_KEY_LENGTH = 44;
const ACCESS_KEY_NUMBER_START = 25;
const ACCESS_KEY_NUMBER_END = 34;

function accessKeyNumbers(lines: string[]): string[] {
  const numbers: string[] = [];

  for (const line of lines) {
    // The key is printed in groups of four, sometimes over two lines.
    const digits = line.replace(/[\s.]/g, "");

    for (const match of digits.match(/\d{44}/g) ?? []) {
      if (match.length === ACCESS_KEY_LENGTH) {
        numbers.push(significantDigits(match.slice(ACCESS_KEY_NUMBER_START, ACCESS_KEY_NUMBER_END)));
      }
    }
  }

  return numbers;
}

function invoiceFound(lines: string[], invoiceNumber: string | null | undefined): boolean | null {
  const expected = significantDigits(invoiceNumber ?? "");

  // A delivery with no number: nothing to look for, and nothing to warn about.
  if (expected.length === 0 || /^0+$/.test(expected)) return null;

  // An empty read is a photo the engine could not read, not a wrong receipt.
  if (lines.length === 0) return null;

  for (const line of lines) {
    if (numberCandidates(line).some((candidate) => significantDigits(candidate) === expected)) {
      return true;
    }
  }

  if (accessKeyNumbers(lines).includes(expected)) return true;

  return false;
}

// dd/mm/yy(yy) with "/", "-" or "." — never glued to another digit, so the
// "/" of "27/09/2026" read as "1" ("27109/2026") is not a date.
const DATE_PATTERN = /(^|[^\d])(\d{1,2})\s?[/.-]\s?(\d{1,2})\s?[/.-]\s?(\d{4}|\d{2})(?!\d)/g;

// Lines whose date is not the receiving one.
const OTHER_DATE_LABELS = /EMISS|VENC|VALID|SAIDA|ENTRADA|NASC|PROTOCOLO|AUTORIZ/;

const RECEIVING_LABEL = "RECEBIMENTO";

/** How many lines below the label the handwritten date may sit. */
const LABEL_REACH = 3;

/** "YYYY-MM-DD" of a day that exists, or null. */
function calendarDay(day: number, month: number, rawYear: string): string | null {
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);

  if (month < 1 || month > 12 || day < 1) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function datesOn(line: string): string[] {
  const days: string[] = [];

  for (const match of line.matchAll(DATE_PATTERN)) {
    const day = calendarDay(Number(match[2]), Number(match[3]), match[4]);
    if (day) days.push(day);
  }

  return days;
}

function dateOutOfWindow(lines: string[], businessDay: string): boolean | null {
  const dated = lines.map((line, index) => ({
    index,
    days: OTHER_DATE_LABELS.test(normalizeText(line)) ? [] : datesOn(line),
  }));

  // Any legible date on the business day: the receipt is dated today.
  if (dated.some((entry) => entry.days.includes(businessDay))) return false;

  const label = lines.findIndex((line) => compactText(line).includes(RECEIVING_LABEL));

  if (label >= 0) {
    const near = dated.find(
      (entry) =>
        entry.index >= label && entry.index <= label + LABEL_REACH && entry.days.length > 0,
    );

    return near ? true : null;
  }

  // Label lost to blur: a stub alone (no DANFE under it) carries one
  // handwritten date on a line of its own.
  const all = lines.map(compactText).join("|");
  const alone = dated.filter(
    (entry) => entry.days.length === 1 && compactText(lines[entry.index]).length <= 10,
  );

  if (!all.includes("DANFE") && alone.length === 1) return true;

  return null;
}

function checkProof(lines: string[], input: ProofCheckInput): ProofCheck {
  return {
    invoice_number_found: invoiceFound(lines, input.invoiceNumber),
    date_out_of_window: lines.length === 0 ? null : dateOutOfWindow(lines, input.businessDay),
  };
}

/**
 * The company's civil day of `at` (decision 1.1), "YYYY-MM-DD". The zone is
 * the one the day's payload carries (`journey.time_zone`); an invalid or
 * absent one falls back to the company default.
 */
function businessDayOf(at: Date, timeZone: string | null | undefined): string {
  const format = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);

    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";

    return `${part("year")}-${part("month")}-${part("day")}`;
  };

  try {
    return format(timeZone || "America/Sao_Paulo");
  } catch {
    return format("America/Sao_Paulo");
  }
}

export { businessDayOf, checkProof };
export type { ProofCheck, ProofCheckInput };
