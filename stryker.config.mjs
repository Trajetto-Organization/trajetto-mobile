// Mutation testing of the app's critical rules (decision 13.5): the offline
// outbox (submission keys, ownership, retry/discard), the offline cache, the
// module gate, and the delivery/occurrence/pause state rules.
//
// @stryker-mutator 8.7 is the last line whose Vitest runner accepts Vitest 1.x
// (9.0 requires Vitest >= 2); pinned so the runner and the suite stay in step.
//
// Run: npm run test:mutation
// Smoke / one file: MUTATION_TESTS=<test globs> npm run test:mutation -- --mutate <file>
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.mutation.config.ts" },
  coverageAnalysis: "perTest",
  mutate: [
    // Offline outbox and cache: what is resent, to whom, and when it is dropped.
    "features/submissions/outbox-rules.ts",
    "features/submissions/outbox.ts",
    "features/submissions/pending-item-rules.ts",
    "features/submissions/submission-id.ts",
    "features/submissions/submission-owner.ts",
    "features/submissions/logout-rules.ts",
    "features/submissions/queue-decision.ts",
    "features/submissions/submit-or-queue.ts",
    "features/submissions/kind-refusals.ts",
    "features/offline/offline-cache-rules.ts",
    // Module gate.
    "features/access/module-rules.ts",
    // State rules.
    "features/deliveries/delivery-rules.ts",
    "features/deliveries/delivery-draft-rules.ts",
    "features/occurrences/authorization-rules.ts",
    "features/occurrences/occurrence-queue-rules.ts",
    "features/pauses/pause-rules.ts",
  ],
  // Root-anchored: modules/text-reader/android is product code a test reads.
  ignorePatterns: ["/coverage", "/reports", "/android", "/ios", "/.expo", "/dist", "/assets"],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // break 90: the 06/10/2026 run scored API 96.17, web 96.53, app 97.16
  // (docs/testes.md, mutation section); 90 leaves a margin and
  // fails a run that loses a real share of the killed mutants.
  thresholds: { high: 90, low: 75, break: 90 },
  tempDirName: ".stryker-tmp",
  // Static mutants (module-level label/rule tables) stay in: the related test
  // set is small enough here that rerunning it per static mutant is cheap.
  // 16 logical CPUs shared with the editor and Docker: 6 runners stay under ~4 GB.
  concurrency: 6,
};
