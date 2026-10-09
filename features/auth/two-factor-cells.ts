import type { ThemeColors } from "@/utils/theme-rules";

/**
 * The colours of the six code cells. An invalid code paints every cell that
 * is not being typed in, filled or not: the filled style is applied on top of
 * the base one, so it must carry the error too or the typed digits look valid
 * next to red empty cells. The focused cell keeps the primary colour so the
 * driver still sees where the next digit goes.
 */
function twoFactorCellColors(colors: ThemeColors, invalid: boolean) {
  const idle = invalid
    ? { borderColor: colors.destructive, backgroundColor: colors.destructiveSoft }
    : null;

  return {
    base: idle ?? { borderColor: colors.input, backgroundColor: colors.card },
    focused: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    filled: idle ?? { borderColor: colors.muted, backgroundColor: colors.card },
  };
}

export { twoFactorCellColors };
