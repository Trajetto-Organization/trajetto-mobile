import { describe, expect, it } from "vitest";

import { truncateText } from "@/utils/truncate-text";

/**
 * Text cut to a limit before it goes to the API (sec-api, 10/2026): a lone
 * UTF-16 surrogate is now a 400 VALIDATION_ERROR. `slice(0, N)` cut an emoji
 * in half at the limit; the API's limits count code units, so cutting by code
 * point would overflow them instead.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("truncateText", () => {
  it("leaves a text within the limit alone", () => {
    expect(truncateText("olá 😀", 10)).toBe("olá 😀");
  });

  it("drops the half emoji at the limit instead of leaving a lone surrogate", () => {
    const cut = truncateText(`${"a".repeat(9)}😀`, 10);

    expect(cut).toBe("a".repeat(9));
    expect(cut).not.toMatch(LONE_SURROGATE);
  });

  it("keeps a whole emoji that fits and never exceeds the unit limit", () => {
    const cut = truncateText("😀😀😀", 4);

    expect(cut).toBe("😀😀");
    expect(cut.length).toBeLessThanOrEqual(4);
  });

  it("cuts plain text exactly at the limit", () => {
    expect(truncateText("abcdef", 3)).toBe("abc");
  });
});
