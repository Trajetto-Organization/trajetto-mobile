import { z } from "zod";

/**
 * What "Estou a caminho" may send, mirrored from the API
 * (`trajetto-api/src/modules/route/usecases/mark-stop-on-the-way/mark-stop-on-the-way-schema.ts`).
 *
 * Parsed before `submitOrQueue`: from the queue a 400 is a failure the driver
 * can only discard. The position is optional (a phone without a fix still
 * marks), but it goes as a pair or not at all.
 */

const latitudeField = z
  .number({ invalid_type_error: "A latitude deve ser um número." })
  .min(-90, "A latitude é inválida.")
  .max(90, "A latitude é inválida.");

const longitudeField = z
  .number({ invalid_type_error: "A longitude deve ser um número." })
  .min(-180, "A longitude é inválida.")
  .max(180, "A longitude é inválida.");

/** `POST /route/on-the-way/:stopId/route/:routeId/business/:businessId` */
const onTheWayBodySchema = z
  .object({
    client_submission_id: z
      .string({ required_error: "A chave de idempotência do envio é obrigatória." })
      .uuid("A chave de idempotência do envio é inválida."),
    occurred_at: z.string().datetime("O horário do registro é inválido."),
    latitude: latitudeField.optional(),
    longitude: longitudeField.optional(),
  })
  .superRefine((value, ctx) => {
    const hasLatitude = value.latitude !== undefined;
    const hasLongitude = value.longitude !== undefined;

    if (hasLatitude !== hasLongitude) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasLatitude ? "longitude" : "latitude"],
        message: "Envie a latitude e a longitude juntas, ou nenhuma das duas.",
      });
    }
  });

type OnTheWayBody = z.infer<typeof onTheWayBodySchema>;

export { onTheWayBodySchema };
export type { OnTheWayBody };
