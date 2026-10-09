import type { ReactNode } from "react";
import { View } from "react-native";
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form";

import type { FieldFocus } from "@/features/forms/use-field-focus";

/**
 * Marks where a field sits in the form, so a failed submit can scroll to it
 * (`use-field-focus`). `collapsable={false}`: Android drops a View with no
 * style of its own from the native tree, and a dropped node cannot be
 * measured. Without `focus` it is a plain View.
 */
export const FieldAnchor = ({
  name,
  focus,
  className,
  children,
}: {
  name: string;
  focus?: Pick<FieldFocus, "anchorRef">;
  className?: string;
  children: ReactNode;
}) => (
  <View ref={focus?.anchorRef(name)} collapsable={false} className={className}>
    {children}
  </View>
);

/**
 * A react-hook-form Controller inside its FieldAnchor: the long forms (the
 * checklist) mark every field without a wrapper per call site.
 */
export function AnchoredController<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  focus,
  ...props
}: ControllerProps<TFieldValues, TName> & { focus?: Pick<FieldFocus, "anchorRef"> }) {
  return (
    <FieldAnchor name={props.name} focus={focus}>
      <Controller {...props} />
    </FieldAnchor>
  );
}
