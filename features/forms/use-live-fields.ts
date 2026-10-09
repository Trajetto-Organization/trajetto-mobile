import { useCallback, useMemo, useState } from "react";

import { firstInvalidField, visibleIssues, type FieldIssues } from "./live-validation";

/**
 * Which fields were visited and whether a submit was tried: the only state
 * live validation needs. Split from the messages so a screen whose issues
 * are derived far below its state (the delivery proof, the occurrence) can
 * declare it next to its other state — a review prefill marks the attempt
 * before the issues exist in the render.
 */
function useLiveFieldState() {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState<boolean>(false);

  /** The driver left the field, or gave a complete answer (a choice, a photo). */
  const touch = useCallback((field: string) => {
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  }, []);

  /** Another form on the same screen (another type), or a discarded draft. */
  const reset = useCallback((options?: { attempted?: boolean }) => {
    setTouched({});
    setAttempted(options?.attempted ?? false);
  }, []);

  return { touched, attempted, touch, reset, setAttempted };
}

type LiveFieldState = ReturnType<typeof useLiveFieldState>;

/** The messages to show for a given state, and the submit attempt. */
function useLiveFieldMessages(
  state: LiveFieldState,
  {
    issues,
    order,
  }: {
    /** Every field's current message, valid ones null. */
    issues: FieldIssues;

    /** Fields in screen order: the first invalid one is brought into view. */
    order: readonly string[];
  },
) {
  const { touched, attempted, setAttempted } = state;

  const visible = useMemo(
    () => visibleIssues(issues, touched, attempted),
    [issues, touched, attempted],
  );

  /**
   * A submit (or a refusal that points at fields): from now on every message
   * shows. Returns the first invalid field, or null when the form may go.
   */
  const attempt = useCallback((): string | null => {
    setAttempted(true);
    return firstInvalidField(order, issues);
  }, [issues, order, setAttempted]);

  const errorOf = useCallback((field: string): string | undefined => visible[field], [visible]);

  return { ...state, visible, errorOf, attempt };
}

/**
 * Live validation for a form held in plain state or for the files beside a
 * react-hook-form (photos): the same rule as `LIVE_VALIDATION_FORM_OPTIONS`.
 * The messages are derived by the caller on every render (schema + rules on
 * the current values); the only state is which fields were visited and
 * whether a submit was tried, so typing costs no extra render.
 */
function useLiveFields(options: { issues: FieldIssues; order: readonly string[] }) {
  return useLiveFieldMessages(useLiveFieldState(), options);
}

export { useLiveFields, useLiveFieldState, useLiveFieldMessages };
export type { LiveFieldState };
