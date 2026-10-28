// Pure on purpose (no react-native import): the unit tests run in Node.

/**
 * The toast card's geometry, in place of react-native-toast-message's
 * BaseToast defaults, which suit one short line only: a fixed `height: 60`, a
 * fixed `width: 340`, a 2px gap under the title and no line height. With our
 * 15px title and a message of up to three lines, the column overflowed the
 * 60px box and the title sat glued to the message below ("Erro" over
 * "Credenciais inválidas"), and 340px ran past the edges of a 320dp phone.
 *
 * The card grows with its text instead (the library measures each toast for
 * its slide), keeps one gap between title and message whatever the font
 * scale (React Native scales `lineHeight` with the font), and takes the
 * screen's width up to a tablet-friendly cap. One table for every kind, so
 * success, error and info always line up.
 */
export const TOAST_LAYOUT = {
  card: {
    height: "auto",
    minHeight: 60,
    width: "92%",
    maxWidth: 480,
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    // A gap, not a margin under the title: a toast with no message stays
    // centred, with nothing hanging below its only line.
    gap: 4,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    marginBottom: 0,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
  },
  titleLines: 2,
  messageLines: 3,
} as const;

/** Space between the status bar and the toast. */
export const TOAST_STATUS_BAR_GAP = 12;

/**
 * Where a top toast rests: just below the status bar, whatever its height.
 * The library's fixed 40px sat under a taller status bar (punch-hole and
 * notched phones, drawn edge-to-edge) and floated too low on a short one.
 */
export function toastTopOffset(topInset: number): number {
  return Math.max(0, topInset) + TOAST_STATUS_BAR_GAP;
}
