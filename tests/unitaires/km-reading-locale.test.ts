import fs from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { formatKmReading } from "@/utils/formatters";

/**
 * Found by the Maestro checklist flow (04b) on the emulator, whose language
 * is English: the vehicle card of the checklist read "Quilometragem atual:
 * 50,120 km". `toLocaleString()` with no locale follows the phone, and in
 * Brazil "50,120" is fifty km. The app is pt-BR whatever the phone says.
 */
describe("a stored km reading on screen", () => {
  it("uses the Brazilian thousands separator", () => {
    expect(formatKmReading(50120)).toBe("50.120");
    expect(formatKmReading(1234567)).toBe("1.234.567");
    expect(formatKmReading(999)).toBe("999");
    expect(formatKmReading(0)).toBe("0");
  });

  it("is null when there is no reading", () => {
    expect(formatKmReading(null)).toBeNull();
    expect(formatKmReading(undefined)).toBeNull();
    expect(formatKmReading(Number.NaN)).toBeNull();
  });
});

const ROOT = resolve(__dirname, "..", "..");
const APP_CODE = ["app", "components", "features", "hooks", "providers", "store", "utils"];

const sourceFiles = (dir: string): string[] =>
  fs.existsSync(join(ROOT, dir))
    ? fs.readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(entry.name) ? [path] : [];
      })
    : [];

describe("number and date formatting in app code", () => {
  it("never leaves the locale to the phone", () => {
    const offenders = APP_CODE.flatMap(sourceFiles).flatMap((file) =>
      fs
        .readFileSync(join(ROOT, file), "utf8")
        .split(/\r?\n/)
        .map((line, index) => ({ line, at: `${file}:${index + 1}` }))
        // Comments may name the call; code may not make it.
        .filter(({ line }) => !/^\s*(\*|\/\/)/.test(line))
        .filter(({ line }) => /\.toLocale(Date|Time)?String\(\s*\)/.test(line))
        .map(({ at }) => at),
    );

    expect(offenders).toEqual([]);
  });
});
