// Pure on purpose (no react-native import): the unit tests run in Node.

/**
 * Space between a bottom sheet's last control and Android's navigation bar,
 * or the screen's edge on a phone that has none.
 */
export const SHEET_BOTTOM_GAP = 16;

/**
 * Bottom padding of a bottom sheet's body (components/ui/sheet.tsx).
 *
 * The sheet is drawn edge-to-edge, down behind the navigation bar. The photo
 * sheet used `Math.max(inset, 16)`, which treats the bar and the gap as
 * alternatives: on a phone with a 48dp three-button bar the padding was the
 * bar alone, and a fully expanded sheet left "Cancelar" touching it; the
 * other sheets padded a fixed 16-24dp and ended behind it. The gap goes on
 * top of the inset instead: 16dp on a phone without a bar, 16dp above the
 * bar otherwise, never more.
 */
export function sheetBottomPadding(bottomInset: number): number {
  return Math.max(0, bottomInset) + SHEET_BOTTOM_GAP;
}
