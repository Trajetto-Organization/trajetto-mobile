import fs from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { coverageConfigDefaults, defaultExclude, defaultInclude } from "vitest/config";

import config from "../../vitest.config";

/**
 * Coverage measured for real in the app too (decision 13.1), as the API does:
 * the branch CI runs the unit tests with coverage and publishes the report.
 * Measured, published and gated by a floor at the measured baseline (MOB-30).
 *
 * "For real" means every folder of app code counts, the screens the unit
 * tests never render included: excluding them would only inflate the number.
 */
const ROOT = resolve(__dirname, "..", "..");
const read = (path: string) => fs.readFileSync(join(ROOT, path), "utf8");
const json = (path: string) => JSON.parse(read(path));

// The app's own code: what legal-facts and the accent scan also read, plus
// the TypeScript side of the local Expo modules.
const APP_CODE = [
  "app",
  "components",
  "features",
  "hooks",
  "modules",
  "providers",
  "schemas",
  "store",
  "types",
  "utils",
];

// Every .ts/.tsx of app code except declaration files (type-only, no code).
const productFiles = (dir: string): string[] =>
  fs.readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : productFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });

describe("unit test coverage", () => {
  it("uses the v8 provider of the SAME vitest version", () => {
    const { devDependencies } = json("package.json");

    // Pinned exactly: @vitest/coverage-v8 has vitest as an exact peer.
    expect(devDependencies["@vitest/coverage-v8"]).toBe(devDependencies.vitest);

    const load = createRequire(join(ROOT, "package.json"));
    expect(load("@vitest/coverage-v8/package.json").version).toBe(load("vitest/package.json").version);
  });

  it("measures every folder of app code, and nothing is carved out of it", () => {
    const coverage = config.test?.coverage as {
      provider?: string;
      all?: boolean;
      include?: string[];
      exclude?: string[];
    };

    expect(coverage?.provider).toBe("v8");
    // Untested files count as 0% instead of vanishing from the total.
    expect(coverage?.all).toBe(true);
    expect([...(coverage?.include ?? [])].sort()).toEqual(APP_CODE.map((dir) => `${dir}/**/*.{ts,tsx}`).sort());

    // Only the tests themselves may be left out, never app code.
    for (const pattern of coverage?.exclude ?? []) {
      expect(APP_CODE.some((dir) => pattern.startsWith(`${dir}/`)), pattern).toBe(false);
    }
  });

  it("drops no app code file, whatever its name", () => {
    const coverage = config.test?.coverage as { include?: string[]; exclude?: string[] };
    // The filter the v8 provider itself applies (@vitest/coverage-v8 1.6,
    // provider.js): test-exclude over Vitest's defaults plus the coverage exclude.
    const providerRequire = createRequire(createRequire(join(ROOT, "package.json")).resolve("@vitest/coverage-v8"));
    const TestExclude = providerRequire("test-exclude");
    const filter = new TestExclude({
      cwd: ROOT,
      include: coverage.include,
      exclude: [...defaultExclude, ...defaultInclude, ...(coverage.exclude ?? coverageConfigDefaults.exclude)],
      excludeNodeModules: true,
      relativePath: true,
    }) as { shouldInstrument: (file: string) => boolean };

    const files = APP_CODE.filter((dir) => fs.existsSync(join(ROOT, dir))).flatMap(productFiles);
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => !filter.shouldInstrument(join(ROOT, file)))).toEqual([]);
    // A file named like a test (Vitest's default `*-spec.ts`) is still app code.
    expect(filter.shouldInstrument(join(ROOT, "features/sync/public-spec.ts"))).toBe(true);
    expect(filter.shouldInstrument(join(ROOT, "features/sync/public.spec.ts"))).toBe(false);
  });

  it("fails the run when coverage drops below the measured floor", () => {
    const coverage = config.test?.coverage as {
      thresholds?: Record<string, number>;
    };

    // The 07/10/2026 baseline, rounded down (52.54 / 87.26 / 81.05 / 52.54).
    // Every metric is gated: a floor on lines alone would let the branch
    // coverage of the rules erode unnoticed.
    expect(coverage?.thresholds).toEqual({
      statements: 52,
      branches: 87,
      functions: 81,
      lines: 52,
    });
  });

  it("runs in the branch CI and publishes the report", () => {
    const ci = read(".github/workflows/ci.yml");

    expect(ci).toMatch(/^\s+run: npm test -- --coverage\b/m);
    expect(ci).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+\n\s+with:\n\s+name: coverage-\$\{\{ github\.sha \}\}\n\s+path: coverage\n/);
    expect(json("package.json").scripts["test:coverage"]).toBe("vitest run --dir tests/unitaires --coverage");
  });

  it("keeps the report out of git and out of the EAS upload", () => {
    for (const file of [".gitignore", ".easignore"]) {
      expect(read(file).split(/\r?\n/), file).toContain("coverage/");
    }
  });
});
