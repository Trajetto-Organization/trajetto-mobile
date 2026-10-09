/**
 * The occurrence form's answers as the screen holds them (decision 6.2).
 *
 * Import-free on purpose: the delivery draft rules read these back from disk
 * and must stay testable without a device or a schema library.
 */

/**
 * One field as the screen holds it: the text typed (text, number), the
 * option or `AAAA-MM-DD` picked (select, date), Sim/Não (boolean), or
 * nothing yet.
 */
type DraftAnswer = string | boolean | null;
type DraftAnswers = Record<string, DraftAnswer>;

/** A stored draft's answers, tolerant of anything a build did not write. */
function reviveDraftAnswers(stored: unknown): DraftAnswers {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};

  const draft: DraftAnswers = {};

  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      draft[key] = value;
    }
  }

  return draft;
}

/**
 * Answers already sent, back into the inputs (a queued report reviewed): a
 * number becomes the text the driver would type, with the Brazilian comma.
 */
function draftAnswersOf(sent: unknown): DraftAnswers {
  if (!sent || typeof sent !== "object" || Array.isArray(sent)) return {};

  const draft: DraftAnswers = {};

  for (const [key, value] of Object.entries(sent as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      draft[key] = String(value).replace(".", ",");
    } else if (typeof value === "string" || typeof value === "boolean") {
      draft[key] = value;
    }
  }

  return draft;
}

export { draftAnswersOf, reviveDraftAnswers };
export type { DraftAnswer, DraftAnswers };
