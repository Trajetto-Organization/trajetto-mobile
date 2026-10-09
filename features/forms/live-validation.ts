import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";

import { formatKmReading } from "@/utils/formatters";

/**
 * Live validation on the phone, "reward early, punish late" (decision
 * 16.700, the same standard as the web's `useLiveValidation`):
 *
 * - a field is checked when the driver leaves it the first time (blur) and on
 *   every change after that — never while the first attempt is being typed;
 * - a message goes away on the keystroke that fixes the value;
 * - a submit checks everything, stops while anything is invalid and brings
 *   the first invalid field into view (and focus, when it takes focus);
 * - a choice (select, date, Sim/Não, photo) is a complete answer: picking it
 *   counts as leaving the field.
 *
 * Pure on purpose (no React, no native): what decides what the driver sees
 * is tested as is. The screens and `use-live-fields` / `use-field-focus`
 * only wire it.
 */

/**
 * react-hook-form's own name for the rule above: first check on blur, then
 * on change; after a submit every field re-checks on change. Focus is ours
 * (`use-field-focus`): RHF's would only reach text inputs, never scroll to a
 * photo or a select.
 */
const LIVE_VALIDATION_FORM_OPTIONS = {
  mode: "onTouched",
  reValidateMode: "onChange",
  shouldFocusError: false,
} as const;

/** Messages by field; `null`/`undefined` means valid. */
type FieldIssues = Readonly<Record<string, string | null | undefined>>;

/** Only the fields with a message. */
function presentIssues(issues: FieldIssues): Record<string, string> {
  const present: Record<string, string> = {};

  for (const [field, message] of Object.entries(issues)) {
    if (typeof message === "string" && message.length > 0) present[field] = message;
  }

  return present;
}

/**
 * What to show now: every problem once the driver tried to send; before
 * that only the fields already visited — a form that opens covered in red
 * says nothing the asterisks do not.
 */
function visibleIssues(
  issues: FieldIssues,
  touched: Readonly<Record<string, boolean>>,
  attempted: boolean,
): Record<string, string> {
  const present = presentIssues(issues);
  if (attempted) return present;

  return Object.fromEntries(Object.entries(present).filter(([field]) => touched[field] === true));
}

/**
 * The first invalid field in screen order — the one a submit brings into
 * view. A field missing from `order` still counts (after the listed ones),
 * so an unlisted rule never lets a submit fail silently.
 */
function firstInvalidField(
  order: readonly string[],
  issues: Readonly<Record<string, unknown>>,
): string | null {
  const isInvalid = (field: string) => {
    const issue = issues[field];
    return issue !== undefined && issue !== null && issue !== "";
  };

  for (const field of order) {
    if (isInvalid(field)) return field;
  }

  return Object.keys(issues).find(isInvalid) ?? null;
}

/** react-hook-form's error tree as plain messages (first level). */
function messagesOf(errors: FieldErrors | Readonly<Record<string, unknown>>): Record<string, string> {
  const messages: Record<string, string> = {};

  for (const [field, error] of Object.entries(errors)) {
    const message = (error as { message?: unknown } | undefined)?.message;
    if (typeof message === "string" && message.length > 0) messages[field] = message;
  }

  return messages;
}

/**
 * A resolver that adds rules the schema cannot know (against data already
 * loaded on the phone, like the vehicle's mileage) to the schema's own
 * verdict. The schema's message wins on a field it already refuses: "is
 * required" says more than "is below the vehicle's".
 */
function withLiveRules<TValues extends FieldValues>(
  resolver: Resolver<TValues>,
  rules: (values: TValues) => FieldIssues,
): Resolver<TValues> {
  return async (values, context, options) => {
    const result = await resolver(values, context, options);
    const extra = presentIssues(rules(values));

    const errors: Record<string, unknown> = { ...(result.errors as Record<string, unknown>) };
    let added = false;

    for (const [field, message] of Object.entries(extra)) {
      if (errors[field]) continue;
      errors[field] = { type: "live", message };
      added = true;
    }

    if (!added) return result;

    return { values: {}, errors: errors as FieldErrors<TValues> };
  };
}

/**
 * Whether the main button is enabled (decision 16.701). A create form's is:
 * pressing it is how the driver finds out what is missing, and a disabled
 * button hides why. An edit form's waits for a change. Busy (sending, data
 * still loading) is the only other reason.
 */
function canSubmitForm({
  isBusy,
  isEdit = false,
  isDirty = true,
}: {
  isBusy: boolean;
  isEdit?: boolean;
  isDirty?: boolean;
}): boolean {
  if (isBusy) return false;
  return isEdit ? isDirty : true;
}

/** A km as typed or stored; empty or nonsense is the schema's business. */
function asReading(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;

  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

interface MileageAgainstVehicleInput {
  /** What was typed, as a number. */
  mileage: unknown;

  /** The form's current date (ISO string). */
  date: unknown;

  /** The ISO string the form defaulted its date to when it opened. */
  defaultDate: string | null | undefined;

  /** The vehicle's current mileage as loaded; unknown while it loads. */
  vehicleMileage: number | null | undefined;
}

/**
 * The km against the vehicle's, as far as the phone can tell (decision
 * 16.703, the web's rule). The API places a reading by its moment: while the
 * date is still the form's untouched default (the moment it opened) the
 * reading is surely the newest, so it must be above the vehicle's. Any
 * picked date may fit between older readings only the API knows, and the
 * phone never blocks what the server would accept — that includes a reading
 * typed offline and queued, which the API places when it arrives.
 */
function mileageAgainstVehicleIssue({
  mileage,
  date,
  defaultDate,
  vehicleMileage,
}: MileageAgainstVehicleInput): string | null {
  if (!defaultDate || date !== defaultDate) return null;

  const typed = asReading(mileage);
  if (typed === null || typeof vehicleMileage !== "number" || vehicleMileage <= 0) return null;
  if (typed > vehicleMileage) return null;

  return `A quilometragem deve ser maior que a atual do veículo (${formatKmReading(vehicleMileage)} km).`;
}

export {
  LIVE_VALIDATION_FORM_OPTIONS,
  canSubmitForm,
  firstInvalidField,
  messagesOf,
  mileageAgainstVehicleIssue,
  presentIssues,
  visibleIssues,
  withLiveRules,
};

export type { FieldIssues, MileageAgainstVehicleInput };
