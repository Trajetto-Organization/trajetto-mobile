import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";
import type { ZodTypeAny } from "zod";

import { mileageAgainstVehicleIssue, withLiveRules } from "./live-validation";

/**
 * The resolver of a form with a km reading (refuelling, checklist): the
 * form's own schema plus the km against the loaded vehicle's (decision
 * 16.703), checked live like any other rule. One place, so both forms say
 * the same sentence under the same conditions.
 */
function resolverWithVehicleMileage<TValues extends FieldValues>(
  schema: ZodTypeAny,
  {
    mileageField,
    dateField,
    defaultDate,
    vehicleMileage,
  }: {
    mileageField: keyof TValues & string;
    dateField: keyof TValues & string;

    /** The date the form opened with: only then is the reading surely the newest. */
    defaultDate: string | null | undefined;

    /** The vehicle's km as loaded; unknown while it loads. */
    vehicleMileage: number | null | undefined;
  },
): Resolver<TValues> {
  return withLiveRules<TValues>(zodResolver(schema) as unknown as Resolver<TValues>, (values) => ({
    [mileageField]: mileageAgainstVehicleIssue({
      mileage: values[mileageField],
      date: values[dateField],
      defaultDate,
      vehicleMileage,
    }),
  }));
}

export { resolverWithVehicleMileage };
