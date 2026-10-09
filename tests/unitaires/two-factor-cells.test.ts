import { describe, expect, it } from "vitest";

import { twoFactorCellColors } from "@/features/auth/two-factor-cells";
import { palette } from "@/utils/theme-tokens";

describe("two-factor code cells", () => {
  it.each(["light", "dark"] as const)("an invalid code paints the filled cells red too (%s)", (scheme) => {
    const colors = palette[scheme];
    const cells = twoFactorCellColors(colors, true);

    // The filled style is applied over the base one: both carry the error.
    expect(cells.base).toEqual({ borderColor: colors.destructive, backgroundColor: colors.destructiveSoft });
    expect(cells.filled).toEqual(cells.base);
    expect(cells.focused.borderColor).toBe(colors.primary);
  });

  it("a valid code keeps the neutral cells", () => {
    const colors = palette.light;
    const cells = twoFactorCellColors(colors, false);

    expect(cells.base.borderColor).toBe(colors.input);
    expect(cells.filled.borderColor).toBe(colors.muted);
  });
});
