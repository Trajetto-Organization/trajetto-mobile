import { Text, TouchableOpacity, View } from "react-native";

import { DatePicker, Input, Select } from "../../ui";

import {
  dateOnlyOfLocalDate,
  localDateOfDateOnly,
} from "@/features/occurrences/occurrence-form";
import type {
  DraftAnswer,
  DraftAnswers,
} from "@/features/occurrences/draft-answers";
import type { OccurrenceFormField } from "@/features/occurrences/occurrence-form-rules";
import type { FieldFocus } from "@/features/forms/use-field-focus";
import { FieldAnchor } from "../../forms/field-anchor";

import {
  normalizeMultilineText,
  normalizeSingleLineText,
} from "@/schemas/text-rules";

interface OccurrenceFormFieldsProps {
  fields: OccurrenceFormField[];
  answers: DraftAnswers;

  /** Only the messages to show now (`visibleIssues`). */
  errors: Record<string, string>;

  onChange: (key: string, value: DraftAnswer) => void;

  /**
   * The driver left a typed answer (text, number): from then on its message
   * follows the value (decision 16.700). A choice reports through onChange.
   */
  onBlur?: (key: string) => void;

  /** Where a failed submit scrolls to and focuses; anchors are the field keys. */
  fieldFocus?: FieldFocus;

  disabled?: boolean;
}

/** `Nome *` / `Nome (opcional)` (decision 3.3); the asterisk is the input's own. */
const labelOf = (field: OccurrenceFormField): string =>
  field.required ? field.label : `${field.label} (opcional)`;

/** "Entre 1 e 10 · número inteiro", from what the company configured. */
function numberHint(field: OccurrenceFormField): string | null {
  const parts: string[] = [];

  if (field.min !== undefined && field.max !== undefined) {
    parts.push(`Entre ${field.min} e ${field.max}`);
  } else if (field.min !== undefined) {
    parts.push(`No mínimo ${field.min}`);
  } else if (field.max !== undefined) {
    parts.push(`No máximo ${field.max}`);
  }

  if (field.integer) parts.push(parts.length > 0 ? "número inteiro" : "Número inteiro");

  return parts.length > 0 ? parts.join(" · ") : null;
}

const Help = ({ text }: { text?: string | null }) =>
  text ? <Text className="mt-1 text-xs text-muted">{text}</Text> : null;

const ClearAnswer = ({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={`Limpar a resposta de ${label}`}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    className="mt-1 self-start"
  >
    <Text className="text-xs font-medium text-primary">Limpar resposta</Text>
  </TouchableOpacity>
);

/** Sim/Não as two buttons: an unanswered question is not a "Não". */
const YesNo = ({
  field,
  value,
  error,
  onChange,
  disabled,
}: {
  field: OccurrenceFormField;
  value: DraftAnswer;
  error?: string;
  onChange: (value: DraftAnswer) => void;
  disabled?: boolean;
}) => (
  <View>
    <Text className="mb-2 font-medium text-ink-soft">
      {labelOf(field)}
      {field.required && <Text className="text-destructive"> *</Text>}
    </Text>

    <View className="flex-row gap-3" accessibilityRole="radiogroup">
      {(
        [
          { answer: true, label: "Sim" },
          { answer: false, label: "Não" },
        ] as const
      ).map(({ answer, label }) => {
        const selected = value === answer;

        return (
          <TouchableOpacity
            key={label}
            // A second tap on an optional answer takes it back.
            onPress={() => onChange(selected && !field.required ? null : answer)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            accessibilityLabel={`${field.label}: ${label}`}
            testID={`occurrence-field-${field.key}-${answer ? "yes" : "no"}`}
            className={`flex-1 items-center rounded-lg border py-3 ${
              selected
                ? "border-primary bg-primary-soft"
                : error
                  ? "border-destructive bg-card"
                  : "border-input bg-card"
            }${disabled ? " opacity-50" : ""}`}
          >
            <Text
              className={`text-base ${
                selected ? "font-semibold text-primary" : "text-ink"
              }`}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>

    {error ? <Text className="mt-1 text-sm text-destructive">{error}</Text> : null}
  </View>
);

/**
 * The questions a company attached to an occurrence type (decision 6.2), in
 * its order: text, number, Sim/Não, a list of options and a date. The checks
 * are the API's (`occurrence-form-rules`); this only draws the inputs and
 * hands each change back as it is typed.
 */
const OccurrenceFormFields = ({
  fields,
  answers,
  errors,
  onChange,
  onBlur,
  fieldFocus,
  disabled,
}: OccurrenceFormFieldsProps) => (
  <View className="mt-3 gap-4">
    {fields.map((field) => {
      const value = answers[field.key] ?? null;
      const error = errors[field.key];

      if (field.type === "boolean") {
        return (
          <FieldAnchor key={field.key} name={field.key} focus={fieldFocus}>
            <YesNo
              field={field}
              value={value}
              error={error}
              disabled={disabled}
              onChange={(answer) => onChange(field.key, answer)}
            />
            <Help text={field.help} />
          </FieldAnchor>
        );
      }

      if (field.type === "select") {
        return (
          <FieldAnchor key={field.key} name={field.key} focus={fieldFocus}>
            <Select
              label={labelOf(field)}
              testID={`occurrence-field-${field.key}`}
              placeholder="Selecione uma opção"
              value={typeof value === "string" ? value : ""}
              onValueChange={(option) => onChange(field.key, option)}
              options={(field.options ?? []).map((option) => ({
                label: option,
                value: option,
              }))}
              error={error}
              disabled={disabled}
              required={field.required}
            />
            <Help text={field.help} />
            {!field.required && typeof value === "string" && value ? (
              <ClearAnswer
                label={field.label}
                disabled={disabled}
                onPress={() => onChange(field.key, null)}
              />
            ) : null}
          </FieldAnchor>
        );
      }

      if (field.type === "date") {
        return (
          <FieldAnchor key={field.key} name={field.key} focus={fieldFocus}>
            <DatePicker
              label={labelOf(field)}
              value={localDateOfDateOnly(value)}
              onDateChange={(date) => onChange(field.key, dateOnlyOfLocalDate(date))}
              error={error}
              disabled={disabled}
              required={field.required}
            />
            <Help text={field.help} />
            {!field.required && typeof value === "string" && value ? (
              <ClearAnswer
                label={field.label}
                disabled={disabled}
                onPress={() => onChange(field.key, null)}
              />
            ) : null}
          </FieldAnchor>
        );
      }

      const text = typeof value === "string" ? value : "";

      if (field.type === "number") {
        return (
          <FieldAnchor key={field.key} name={field.key} focus={fieldFocus}>
            <Input
              label={labelOf(field)}
              testID={`occurrence-field-${field.key}`}
              placeholder="Digite um número"
              inputRef={fieldFocus?.inputRef(field.key)}
              onBlur={() => onBlur?.(field.key)}
              value={text}
              onChangeText={(typed) => onChange(field.key, typed)}
              keyboardType="numeric"
              error={error}
              editable={!disabled}
              required={field.required}
            />
            <Help text={field.help ?? numberHint(field)} />
          </FieldAnchor>
        );
      }

      // Text: the counter reads what will be sent, tidied the same way.
      const max = field.max_length ?? 200;
      const length = (
        field.multiline ? normalizeMultilineText(text) : normalizeSingleLineText(text)
      ).length;

      return (
        <FieldAnchor key={field.key} name={field.key} focus={fieldFocus}>
          <Input
            label={labelOf(field)}
            testID={`occurrence-field-${field.key}`}
            placeholder="Digite a resposta"
            inputRef={fieldFocus?.inputRef(field.key)}
            onBlur={() => onBlur?.(field.key)}
            value={text}
            onChangeText={(typed) => onChange(field.key, typed)}
            multiline={field.multiline === true}
            numberOfLines={field.multiline ? 3 : 1}
            error={error}
            editable={!disabled}
            required={field.required}
          />
          <View className="flex-row justify-between gap-2">
            <View className="flex-1">
              <Help text={field.help} />
            </View>
            <Text className="mt-1 text-xs text-muted">{`${length}/${max}`}</Text>
          </View>
        </FieldAnchor>
      );
    })}
  </View>
);

export { OccurrenceFormFields, numberHint };
