import { z } from "zod";

/**
 * The phone's offline pre-check as the API receives it (decision 14.2),
 * mirrored from trajetto-api `shared/ai-precheck/device-precheck.ts`.
 *
 * Booleans only: the text read never leaves the phone. The API drops a
 * malformed value instead of refusing the submission, but the app still
 * sends only what this schema accepts.
 */
const DEVICE_PRECHECK_ENGINE = "mlkit-text-v2-latin";

const devicePrecheckSchema = z
  .object({
    engine: z.literal(DEVICE_PRECHECK_ENGINE),
    engine_version: z.string().max(20),
    rules_version: z.number().int().min(1),
    ran_at: z.string().datetime({ offset: true }),
    duration_ms: z.number().int().min(0).max(60_000),
    kind: z.enum(["proof", "odometer"]),
    invoice_number_found: z.boolean().nullable(),
    date_out_of_window: z.boolean().nullable(),
    typed_mileage_found: z.boolean().nullable(),
    outcome: z.enum(["ok", "warned", "error"]),
    driver_overrode: z.boolean(),
  })
  .strict();

type DevicePrecheck = z.infer<typeof devicePrecheckSchema>;

export { DEVICE_PRECHECK_ENGINE, devicePrecheckSchema };
export type { DevicePrecheck };
