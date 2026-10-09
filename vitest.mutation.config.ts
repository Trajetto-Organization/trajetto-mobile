import { configDefaults, defineConfig } from "vitest/config";

import base from "./vitest.config";

/**
 * Tests that are green in the repository but red inside Stryker's sandbox,
 * for reasons unrelated to the mutated code. None of them imports a file in
 * stryker.config.mjs `mutate`, so leaving them out kills no mutant less.
 */
const SANDBOX_RED = [
  // Asks `git check-ignore` about .env.example: the sandbox lives under
  // .stryker-tmp/, which .gitignore ignores, so every path reads as ignored.
  "tests/unitaires/secrets-hygiene.test.ts",
  // Drives the realtime hook through module mocks and a timer tick; in the
  // runner's single shared process its socket handler fires against another
  // file's mock and the spy is never called. It imports no mutated file.
  "tests/unitaires/notification-chime-foreground.test.ts",
];

/**
 * The test set Stryker runs against each mutant (stryker.config.mjs): the
 * unit suite, or what MUTATION_TESTS (comma-separated globs) narrows it to —
 * which is how a smoke run on one file stays small.
 */
// Spread, not mergeConfig: mergeConfig concatenates arrays, so the base
// `include` would survive and the narrowing would do nothing.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: (process.env.MUTATION_TESTS ?? "tests/unitaires/**/*.test.ts").split(","),
    exclude: [...configDefaults.exclude, ...SANDBOX_RED],
  },
});
