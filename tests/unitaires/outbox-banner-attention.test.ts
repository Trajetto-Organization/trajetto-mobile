import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The banner counts parked submissions (MOB-03).
 *
 * A submission parked while the company had a module switched off does not
 * leave with a connection, and the banner is the only way to the pending
 * screen that explains it and offers "Tentar agora". It counted failed and
 * unclaimed items only, so a parked one was invisible everywhere: no strip,
 * no count, nothing to tap.
 *
 * The selector (failed + unclaimed + parked) is tested in
 * outbox-parked.test.ts; the banner cannot be rendered here, so this pins
 * that it is the count the banner shows.
 */
const banner = readFileSync(
  resolve(__dirname, "../..", "components/outbox-banner.tsx"),
  "utf8",
);

describe("the pending-submissions banner", () => {
  it("counts everything that needs a person, parked included", () => {
    expect(banner).toMatch(
      /const attentionCount = useOutboxStore\(selectNeedsAttentionCount\);/,
    );
  });

  it("no longer sums its own subset of the attention states", () => {
    expect(banner).not.toMatch(/failedCount \+ unclaimedCount/);
  });
});
