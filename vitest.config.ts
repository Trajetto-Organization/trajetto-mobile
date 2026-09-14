import path from "node:path";
import { defineConfig } from "vitest/config";

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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
