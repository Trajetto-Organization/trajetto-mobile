export interface InputFieldState {
  focused: boolean;
  error: boolean;
  editable: boolean;
}

/**
 * The field's border, background and text classes for its state, exactly one
 * of each.
 *
 * NativeWind does not let a later class win over an earlier one of the same
 * property (the stylesheet order does), so appending "bg-destructive-soft"
 * after "bg-subtle" left the invalid field looking valid on the emulator: the
 * message showed, the red border and fill did not. Hence one class per
 * property, picked by priority: error, then read-only, then focus.
 */
export function inputFieldStateClasses({ focused, error, editable }: InputFieldState): string {
  const text = editable ? "text-ink" : "text-muted";

  if (error) return `border-destructive bg-destructive-soft ${text}`;
  if (!editable) return `border-input bg-subtle ${text}`;
  if (focused) return `border-primary bg-card ${text}`;
  return `border-input bg-subtle ${text}`;
}
