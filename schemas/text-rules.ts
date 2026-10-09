/**
 * The free-text rules the driver's delivery forms share with the API.
 *
 * Import-free on purpose: the schemas that use these guard what enters the
 * offline queue, and a test must be able to read them without a device.
 *
 * Two families, because decision 5.5 says so:
 *
 * - single-line text ("Quem recebeu"): no space at either end and no two
 *   whitespace characters in a row — the API's `hasSpaceAtEdges` and
 *   `hasConsecutiveSpaces`;
 * - multiline text (occurrence description): the same, except that line
 *   breaks may repeat. "Cliente ausente.\n\nVizinho informou" is two
 *   paragraphs, not a typo.
 */

/** A line break never counts as a "space" in multiline text (decision 5.5). */
const INLINE_WHITESPACE_RUN = /[^\S\n]{2,}/;
const INLINE_WHITESPACE_AT_LINE_EDGE = /^[^\S\n]|[^\S\n]$/;

/** Two whitespace characters in a row, line breaks excepted. */
function hasInlineConsecutiveSpaces(value: string): boolean {
  return INLINE_WHITESPACE_RUN.test(value);
}

/** A line that starts or ends with a space or a tab. */
function hasSpaceAtLineEdges(value: string): boolean {
  return value
    .split("\n")
    .some((line) => INLINE_WHITESPACE_AT_LINE_EDGE.test(line));
}

/**
 * What a single-line field becomes before it is validated and queued.
 *
 * The driver types on a phone in the street; a double space from the
 * keyboard's autocomplete is not something to argue about in a toast. The
 * app fixes what it can fix without guessing, so the only error left on
 * screen is one the driver has to decide (a name that is too long).
 */
function normalizeSingleLineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The same for multiline text: each line tidied, the line breaks kept.
 *
 * Windows-style breaks become `\n` so the rule above has one kind to read.
 */
function normalizeMultilineText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .trim();
}

export {
  hasInlineConsecutiveSpaces,
  hasSpaceAtLineEdges,
  normalizeMultilineText,
  normalizeSingleLineText,
};
