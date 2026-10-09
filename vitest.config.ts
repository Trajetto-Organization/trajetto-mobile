import path from "node:path";
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Vitest's default coverage exclude also drops `*-spec.ts(x)` / `*-test.ts(x)`,
// a plausible name for app code (the web lost its public-spec.ts that way).
// Tests use the dot form only and live in tests/, so only that form is excluded.
const DASHED_TEST_GLOB = "**/*{.,-}{test,spec}?(-d).?(c|m)[jt]s?(x)";
const DOT_TEST_GLOB = "**/*.{test,spec}?(-d).?(c|m)[jt]s?(x)";

/**
 * Unit tests for the app's decision-making code.
 *
 * The environment is plain Node, not a React Native one, because what is worth
 * testing here does not touch React: the inspection rules, the refuelling
 * rules, and anything else that decides rather than renders. Keeping those free
 * of framework imports is what makes them testable at all, and this config
 * exists to keep that boundary honest — a module that needs a native mock to be
 * tested is a module that has business logic in the wrong place.
 */
export default defineConfig({
  test: {
    environment: "node",

    // Relative to whatever root is in play, so it keeps working when the
    // scripts narrow the run with `--dir`.
    include: ["**/*.test.ts"],

    // Stryker's sandboxes copy the whole app, tests included; a plain run
    // must not execute those stale copies.
    exclude: [...configDefaults.exclude, ".stryker-tmp/**"],

    // Measured for real (decision 13.1): every folder of app code counts,
    // including the screens no unit test renders (`all`), so the number is
    // honest rather than flattering. Only Vitest's defaults are excluded
    // (tests, *.d.ts). Build-time Expo config plugins (plugins/, *.config.js)
    // are not app code. Published by the branch CI, and gated by the floor
    // below.
    coverage: {
      provider: "v8",
      all: true,
      include: [
        "app/**/*.{ts,tsx}",
        "components/**/*.{ts,tsx}",
        "features/**/*.{ts,tsx}",
        "hooks/**/*.{ts,tsx}",
        "modules/**/*.{ts,tsx}",
        "providers/**/*.{ts,tsx}",
        "schemas/**/*.{ts,tsx}",
        "store/**/*.{ts,tsx}",
        "types/**/*.{ts,tsx}",
        "utils/**/*.{ts,tsx}",
      ],
      exclude: coverageConfigDefaults.exclude.map((glob) => (glob === DASHED_TEST_GLOB ? DOT_TEST_GLOB : glob)),
      reporter: ["text-summary", "json-summary", "json", "lcov", "html"],
      reportOnFailure: true,
      // The floor is the baseline measured on 07/10/2026 (MOB-30), rounded
      // down: 52.54% statements/lines, 87.26% branches, 81.05% functions
      // over 54 097 statements, every screen included. It only stops the
      // number from going down; raise it when coverage goes up. Low lines
      // with high branches is the shape of this app: the decisions live in
      // tested pure rules, the bulk of the lines in screens no unit renders.
      thresholds: {
        statements: 52,
        branches: 87,
        functions: 81,
        lines: 52,
      },
      reportsDirectory: "coverage",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
