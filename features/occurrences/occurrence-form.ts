import { z } from "zod";

import {
  normalizeMultilineText,
  normalizeSingleLineText,
} from "@/schemas/text-rules";

import {
  readFormFields,
  validateOccurrenceAnswers,
  type OccurrenceFormAnswers,
  type OccurrenceFormField,
} from "./occurrence-form-rules";
import {
  draftAnswersOf,
  reviveDraftAnswers,
  type DraftAnswer,
  type DraftAnswers,
} from "./draft-answers";

/**
 * The occurrence form on the phone (decision 6.2): what the screen holds
 * while the driver fills it, and what it becomes in the report.
 *
 * Pure and device-free, so what decides whether an answer may enter the
 * offline queue can be tested. The verdict itself is the API's own code
 * (`occurrence-form-rules`, a checked copy); this file only turns what the
 * inputs hold into the values that code reads.
 */

/** A type's form as the phone renders it and reports it. */
interface TypeForm {
  fields: OccurrenceFormField[] | null;

  /**
   * Sent in EVERY report, form or not (contract §7): it is how the API tells
   * this build from one that cannot show forms. 1 when the cached type
   * predates forms — the API then answers 409 with the current form if the
   * answers do not fit it, never a silent loss.
   */
  version: number;
}

interface FormBearingType {
  form_fields?: unknown;
  form_version?: number | null;
}

const NO_FORM: TypeForm = { fields: null, version: 1 };

function typeFormOf(type: FormBearingType | null | undefined): TypeForm {
  if (!type) return NO_FORM;

  const version =
    typeof type.form_version === "number" &&
    Number.isInteger(type.form_version) &&
    type.form_version > 0
      ? type.form_version
      : 1;

  return { fields: readFormFields(type.form_fields ?? null), version };
}

// "1.000" reads as a thousand to a Brazilian and as one to `Number`: neither
// guess is safe, so it is left as text and refused as "deve ser um número".
const THOUSANDS_GROUPED = /^-?\d{1,3}(\.\d{3})+$/;
const PLAIN_NUMBER = /^-?\d+([.,]\d+)?$/;

/** "2,5" → 2.5. Anything else stays text, for the rules to refuse. */
function parseDraftNumber(text: string): number | string {
  const trimmed = text.trim();

  if (THOUSANDS_GROUPED.test(trimmed) || !PLAIN_NUMBER.test(trimmed)) {
    return trimmed;
  }

  return Number(trimmed.replace(",", "."));
}

/**
 * What the inputs hold, as the values the API reads. Text is tidied the way
 * the other delivery forms tidy it (no argument about a double space from the
 * keyboard); a blank field is left out, which is "not answered".
 */
function answerValuesOf(
  fields: OccurrenceFormField[] | null,
  draft: DraftAnswers,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  for (const field of fields ?? []) {
    const raw = Object.prototype.hasOwnProperty.call(draft, field.key)
      ? draft[field.key]
      : null;

    if (raw === null || raw === undefined) continue;

    if (typeof raw !== "string") {
      values[field.key] = raw;
      continue;
    }

    if (field.type === "text") {
      const text = field.multiline
        ? normalizeMultilineText(raw)
        : normalizeSingleLineText(raw);

      if (text) values[field.key] = text;
      continue;
    }

    if (raw.trim().length === 0) continue;

    values[field.key] =
      field.type === "number" ? parseDraftNumber(raw) : raw;
  }

  return values;
}

/**
 * The answers' schema, built from the definition: zod issues by field key,
 * the kept answers as its output. The checks are `validateOccurrenceAnswers`
 * — the API's — so the phone and the server can never disagree on a message.
 */
function occurrenceAnswersSchema(fields: OccurrenceFormField[] | null) {
  return z
    .record(z.unknown())
    .transform((given, ctx): OccurrenceFormAnswers | null => {
      const verdict = validateOccurrenceAnswers(fields, given);
      const problems = Object.entries(verdict.errors);

      for (const [key, message] of problems) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });
      }

      return problems.length > 0 ? z.NEVER : verdict.answers;
    });
}

interface FormCheck {
  answers: OccurrenceFormAnswers | null;

  /** By field key, the message to show under it. Empty when valid. */
  errors: Record<string, string>;
}

function checkOccurrenceForm(form: TypeForm, draft: DraftAnswers): FormCheck {
  const parsed = occurrenceAnswersSchema(form.fields).safeParse(
    answerValuesOf(form.fields, draft),
  );

  if (parsed.success) return { answers: parsed.data, errors: {} };

  const errors: Record<string, string> = {};

  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "");

    if (key && !(key in errors)) errors[key] = issue.message;
  }

  return { answers: null, errors };
}

/** Refused before the queue: the screen points at each field. */
class OccurrenceFormError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super(
      Object.values(fieldErrors)[0] ??
        "As respostas do formulário da ocorrência não são válidas.",
    );

    this.name = "OccurrenceFormError";
  }
}

/**
 * The report's form part: the answers (left out when the type has no form or
 * nothing was answered) and, always, the version the phone showed.
 */
function occurrenceFormPart(
  form: TypeForm,
  draft: DraftAnswers,
): { form_answers?: OccurrenceFormAnswers; form_version: number } {
  const check = checkOccurrenceForm(form, draft);

  if (Object.keys(check.errors).length > 0) {
    throw new OccurrenceFormError(check.errors);
  }

  return check.answers
    ? { form_answers: check.answers, form_version: form.version }
    : { form_version: form.version };
}

/**
 * What to show now: every problem once the driver tried to send, before that
 * only the fields they already touched — a form that opens covered in red
 * "Preencha" says nothing the asterisks do not.
 */
function visibleFieldErrors(
  errors: Record<string, string>,
  touched: Readonly<Record<string, boolean>>,
  attempted: boolean,
): Record<string, string> {
  if (attempted) return errors;

  return Object.fromEntries(
    Object.entries(errors).filter(([key]) => touched[key] === true),
  );
}

/**
 * Whether changing this answer already counts as leaving the field
 * (decision 16.700). A choice — Sim/Não, an option, a date — is a complete
 * answer the moment it is picked; a typed answer (text, number) is only
 * judged once the driver leaves it, never while the first try is typed.
 */
function answerTouchesOnChange(field: Pick<OccurrenceFormField, "type">): boolean {
  return field.type !== "text" && field.type !== "number";
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The picker's day as `AAAA-MM-DD`. The picker works in the phone's zone and
 * hands back its local midnight, so the day is read in that zone — reading it
 * in UTC would give the day before west of Greenwich late in the evening.
 */
function dateOnlyOfLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `AAAA-MM-DD` as the picker's local midnight, or undefined when unreadable. */
function localDateOfDateOnly(value: DraftAnswer | undefined): Date | undefined {
  if (typeof value !== "string") return undefined;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  return Number.isNaN(date.getTime()) ? undefined : date;
}

export {
  OccurrenceFormError,
  answerTouchesOnChange,
  answerValuesOf,
  checkOccurrenceForm,
  dateOnlyOfLocalDate,
  draftAnswersOf,
  localDateOfDateOnly,
  occurrenceAnswersSchema,
  occurrenceFormPart,
  parseDraftNumber,
  reviveDraftAnswers,
  typeFormOf,
  visibleFieldErrors,
};

export type { DraftAnswer, DraftAnswers, FormCheck, TypeForm };
