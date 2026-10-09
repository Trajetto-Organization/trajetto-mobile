import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Where the occurrence form and the tower's authorization show (decisions
 * 6.2 and 6.3). A screen cannot be rendered in this runner, so this reads the
 * screens and holds the wiring the rules depend on — the rules themselves are
 * tested in occurrence-*.test.ts. It still has to be seen on a device; this
 * keeps it from quietly going away.
 */

const read = (file: string) => readFileSync(resolve(__dirname, "../..", file), "utf8");

describe("the stop", () => {
  it("the day's list shows the tower state on each card", () => {
    expect(read("components/screens/deliveries/delivery-card.tsx")).toMatch(
      /<OccurrenceAuthorizationBadge delivery=\{delivery\} \/>/,
    );
  });

  it("the delivery screen shows it with what to do next, and keeps Entregar", () => {
    const detail = read("app/(protected)/delivery-detail.tsx");

    expect(detail).toMatch(/<OccurrenceAuthorizationCard\s+delivery=\{delivery\}\s+occurrenceTypes=\{occurrenceTypes\}/);

    // The proof stays open while the tower decides: the button is not gated
    // on the request.
    expect(detail).toContain("Entregar");
    expect(detail).not.toMatch(/authorization_request[^\n]*canProve|canProve[^\n]*authorization_request/);
  });
});

describe("the report screen", () => {
  const screen = read("app/(protected)/delivery-occurrence.tsx");

  it("draws the type's form and sends its answers through the checked action", () => {
    expect(screen).toContain("<OccurrenceFormFields");
    expect(screen).toMatch(/occurrenceType: selectedType,\s+answers,\s+onRefused: handleRefusal,/);
  });

  it("reopens a queued report for review from the pending screen", () => {
    expect(screen).toContain("reviseQueuedOccurrence(item");
    // The screen of the item's kind (reviewRouteOf, tested in
    // delivered-review-rules.test.ts): a delivery proof reopens on the proof
    // screen (decision 14.3, review r1).
    const pending = read("app/(protected)/pending-submissions.tsx");

    expect(pending).toMatch(/const reviewRoute = view\.reviewLabel \? reviewRouteOf\(item\) : null;/);
    expect(pending).toMatch(/onPress=\{\(\) => router\.navigate\(reviewRoute\)\}/);
  });

  it("reopens a queued delivery proof on the proof screen, under its own company", () => {
    const proof = read("app/(protected)/delivery-proof.tsx");

    expect(proof).toMatch(/item\.id === reviewId && item\.kind === DELIVERED_KIND/);
    expect(proof).toMatch(/if \(reviewEntryOf\(listed, businessId\) !== "open"\) return;/);
    expect(proof).toMatch(/reviseQueuedDelivered\(item, \{\s+businessId,\s+type,/);
  });

  // The rules are in occurrence-queue-rules.test.ts; this keeps both screens
  // asking them with the company selected now.
  it("reviews only under the report's own company", () => {
    expect(read("app/(protected)/pending-submissions.tsx")).toMatch(
      /describePendingItem\(\s+item,\s+classifyOwnership\(item, getSubmissionOwner\(\)\),\s+Date\.now\(\),\s+\{ businessId \},\s+\)/,
    );

    // Judged on the item as first found, whatever its state (a deep link, a
    // back-navigation): another company's report never gets the form.
    expect(screen).toMatch(
      /const reviewEntry = reviewId \? reviewEntryOf\(reviewItem \?\? listed, businessId\) : null;/,
    );
    expect(screen).toMatch(/if \(reviewEntry === "other-company"\) \{/);
    expect(screen).toMatch(/if \(reviewEntry === "no-review"\) \{/);
    expect(screen).toMatch(/if \(reviewEntry === "gone"\) \{/);
    expect(screen).toMatch(/if \(reviewEntryOf\(listed, businessId\) !== "open"\) return;/);
    expect(screen).not.toMatch(/Troque para ela/);
    expect(screen).toMatch(/reviseQueuedOccurrence\(item, \{[\s\S]*?businessId,\s+occurrenceTypeId: selectedType\.id,/);
  });

  it("waits for the current form after a refusal, and reacts through the pure rule", () => {
    expect(screen).toContain("const change = refusalScreenChange(error);");
    // Through the hook that reads the network: offline is not "Buscando…".
    expect(screen).toMatch(
      /const \{ refresh: formRefresh, request: refreshForm \} = useFormRefresh\(\{\s+refetch,\s+listLoading: isListLoading,\s+\}\);/,
    );
    expect(screen).toMatch(/typeListed: selectedType !== null,\s+refresh: formRefresh,/);
    expect(screen).not.toMatch(/setFormRefresh/);
    expect(screen).toMatch(/disabled=\{formState\.typeLocked \|\| isBusy\}/);
    expect(screen).toMatch(/!isBusy &&\s+formState\.canSend;/);
  });
});
