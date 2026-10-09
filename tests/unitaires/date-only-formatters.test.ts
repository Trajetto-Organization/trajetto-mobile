import { execFile } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { formatDateOnly } from "@/utils/formatters";

const run = promisify(execFile);

const FORMATTERS = join(__dirname, "..", "..", "utils", "formatters.ts");

/**
 * Runs `body` in a Node process whose clock is in `timeZone`, with
 * utils/formatters loaded as `lib`.
 *
 * The test runner's own zone cannot be changed from inside it, and a phone in
 * Brazil is always west of UTC — the case the old card formatter got wrong. A
 * child process started with TZ in its environment is in that zone on every
 * OS. Node strips the types itself (the module has no imports).
 */
async function inTimeZone<T>(timeZone: string, body: string): Promise<T> {
  const script = `const lib = await import(${JSON.stringify(pathToFileURL(FORMATTERS).href)});
const result = (() => {${body}})();
process.stdout.write(JSON.stringify(result));`;

  const stripsTypes = Boolean((process.features as { typescript?: unknown }).typescript);

  const { stdout } = await run(
    process.execPath,
    [
      ...(stripsTypes ? [] : ["--experimental-strip-types"]),
      "--no-warnings",
      "--input-type=module",
      "--eval",
      script,
    ],
    { env: { ...process.env, TZ: timeZone }, encoding: "utf8" },
  );

  return JSON.parse(stdout) as T;
}

/**
 * The expected date on the delivery card (decision 1.3).
 *
 * The API stores the civil day as UTC midnight. The card formatted it with
 * `toLocaleDateString` in the phone's zone, so a delivery of the 17th read
 * "16/09" in São Paulo, Manaus and Rio Branco alike.
 */
describe("a date-only value on the phone", () => {
  it("shows the stored day in a Brazilian zone, where the phone's calendar shows the day before", async () => {
    const result = await inTimeZone<Record<string, string | null>>(
      "America/Manaus",
      `return {
        midnightUtc: lib.formatDateOnly("2026-09-17T00:00:00.000Z"),
        key: lib.formatDateOnly("2026-09-17"),
        withYear: lib.formatDateOnly("2026-09-17", { withYear: true }),
        phoneCalendar: new Date("2026-09-17T00:00:00.000Z").toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
        }),
      };`,
    );

    expect(result).toEqual({
      midnightUtc: "17/09",
      key: "17/09",
      withYear: "17/09/2026",
      // What the card showed before.
      phoneCalendar: "16/09",
    });
  });

  it("gives nothing for nothing, so the card can hide the line", () => {
    expect(formatDateOnly(null)).toBeNull();
    expect(formatDateOnly(undefined)).toBeNull();
    expect(formatDateOnly("")).toBeNull();
    expect(formatDateOnly("amanhã")).toBeNull();
  });

  it("reads a Date the same way", () => {
    expect(formatDateOnly(new Date("2026-12-31T00:00:00.000Z"), { withYear: true })).toBe(
      "31/12/2026",
    );
  });
});
