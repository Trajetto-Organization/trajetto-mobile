/**
 * Text helpers shared by the pre-check rules. Pure and import-free.
 *
 * The phone's OCR (ML Kit, Latin) returns lines of text without meaning; the
 * rules only ever COMPARE what was read with what the app already knows (the
 * invoice number of the delivery, the km the driver typed). Comparing is much
 * more robust than extracting, which is what makes a small engine enough.
 */

interface ReadTextLike {
  blocks?: Array<{ lines?: Array<{ text?: unknown }> | null } | null> | null;
}

/** The lines of a read, in the engine's reading order; blanks dropped. */
function linesOf(result: ReadTextLike | null | undefined): string[] {
  const lines: string[] = [];

  for (const block of result?.blocks ?? []) {
    for (const line of block?.lines ?? []) {
      if (typeof line?.text === "string" && line.text.trim().length > 0) {
        lines.push(line.text);
      }
    }
  }

  return lines;
}

/** Upper case without accents: "Emissão" and "EMISSAO" are the same label. */
function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/** Letters and digits only, for label matching ("DATA DE RECEBIMENTO"). */
function compactText(text: string): string {
  return normalizeText(text).replace(/[^A-Z0-9]/g, "");
}

// The usual OCR letter-for-digit swaps.
const LOOKALIKES: Record<string, string> = {
  O: "0",
  o: "0",
  Q: "0",
  D: "0",
  I: "1",
  l: "1",
  "|": "1",
};

/**
 * Applies the swaps only inside a token that is already mostly digits: an
 * "O" in "000.12O.456" is a zero, the one in "CANHOTO" is not.
 */
function fixDigitLookalikes(line: string): string {
  return line.replace(/[0-9OoQDIl|.,]+/g, (token) => {
    const digits = token.replace(/\D/g, "").length;
    const letters = token.replace(/[0-9.,]/g, "").length;

    if (letters === 0 || digits < 3 || digits / (digits + letters) < 0.6) return token;

    return [...token].map((char) => LOOKALIKES[char] ?? char).join("");
  });
}

/** Digits only, leading zeros dropped: "000.123.456" → "123456". */
function significantDigits(text: string): string {
  return text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/**
 * Every way a number may have been printed on one line, as digit strings:
 * plain runs, runs with "." or "," separators, and 3-digit groups split by
 * spaces ("123 456"). More candidates only means fewer false warnings — a
 * match must still be exact.
 */
function numberCandidates(line: string): string[] {
  const fixed = fixDigitLookalikes(line);
  const found = new Set<string>();

  for (const pattern of [/\d+/g, /\d+(?:[.,]\d+)+/g]) {
    for (const match of fixed.match(pattern) ?? []) found.add(match.replace(/\D/g, ""));
  }

  // Whole groups only: "000.123.4567" is not "000.123.456" plus a stray 7.
  for (const match of fixed.matchAll(/(^|[^\d])(\d{1,3}(?:[ .,]\d{3})+)(?![\d])/g)) {
    found.add(match[2].replace(/\D/g, ""));
  }

  return [...found];
}

export {
  compactText,
  fixDigitLookalikes,
  linesOf,
  normalizeText,
  numberCandidates,
  significantDigits,
};
export type { ReadTextLike };
