import { describe, expect, it } from "vitest";

import {
  PRECHECK_RULES_VERSION,
  PrecheckTimeoutError,
  odometerWarning,
  precheckApplies,
  precheckFailure,
  precheckForSubmit,
  precheckResult,
  proofWarning,
  storedPrecheckOf,
  withTimeout,
  type StoredPrecheck,
} from "@/features/ai-precheck/device-precheck";
import { evaluatePrecheck } from "@/features/ai-precheck/evaluate-precheck";
import { devicePrecheckSchema } from "@/schemas/device-precheck";
import { deliveredOccurrenceBodySchema, deliveryProofBodySchema } from "@/schemas/delivery";
import { revisedDeliveredBody } from "@/features/deliveries/delivered-review-rules";
import { reviveProofDraft, withRecoveredPhoto } from "@/features/deliveries/delivery-draft-rules";
import { upcastOutboxItem } from "@/features/submissions/outbox-schema";

/**
 * What the pre-check sends and shows (decision 14.2; design §P7.2–§P7.3):
 * the payload the API accepts, the warnings, the binding to the photo (and
 * km) it read, and a reader that fails or hangs never holding the flow.
 */
const ranAt = new Date("2026-10-05T13:20:00.000Z");
const run = { engineVersion: "16.0.1", ranAt, durationMs: 412.6 };

describe("the payload", () => {
  it("is what the API's schema takes, booleans only", () => {
    const proof = precheckResult(
      { ...run, kind: "proof" },
      { invoice_number_found: true, date_out_of_window: false, typed_mileage_found: true },
    );

    expect(proof).toEqual({
      engine: "mlkit-text-v2-latin",
      engine_version: "16.0.1",
      rules_version: PRECHECK_RULES_VERSION,
      ran_at: "2026-10-05T13:20:00.000Z",
      duration_ms: 413,
      kind: "proof",
      invoice_number_found: true,
      date_out_of_window: false,
      // An odometer answer has no place on a receipt.
      typed_mileage_found: null,
      outcome: "ok",
      driver_overrode: false,
    });
    expect(devicePrecheckSchema.safeParse(proof).success).toBe(true);
  });

  it("is 'warned' on a number not found, a date out of the day, or a km not found", () => {
    expect(
      precheckResult({ ...run, kind: "proof" }, { invoice_number_found: false, date_out_of_window: null })
        .outcome,
    ).toBe("warned");
    expect(
      precheckResult({ ...run, kind: "proof" }, { invoice_number_found: null, date_out_of_window: true })
        .outcome,
    ).toBe("warned");
    expect(precheckResult({ ...run, kind: "odometer" }, { typed_mileage_found: false }).outcome).toBe(
      "warned",
    );
    // Doubt never warns.
    expect(precheckResult({ ...run, kind: "odometer" }, { typed_mileage_found: null }).outcome).toBe(
      "ok",
    );
  });

  it("is 'error' with nothing known when the read failed", () => {
    const failed = precheckFailure({ ...run, kind: "odometer", durationMs: 5_000 });

    expect(failed).toMatchObject({
      outcome: "error",
      invoice_number_found: null,
      date_out_of_window: null,
      typed_mileage_found: null,
      duration_ms: 5_000,
    });
    expect(devicePrecheckSchema.safeParse(failed).success).toBe(true);
  });

  it("rides the proof bodies, and nothing else is accepted in it", () => {
    const precheck = precheckResult({ ...run, kind: "proof" }, { invoice_number_found: true });

    const delivered = deliveredOccurrenceBodySchema.safeParse({
      client_submission_id: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
      occurrenceTypeId: "type-1",
      occurred_at: ranAt.toISOString(),
      form_version: 1,
      device_precheck: precheck,
    });
    expect(delivered.success && delivered.data.device_precheck).toEqual(precheck);

    const legacy = deliveryProofBodySchema.safeParse({
      client_submission_id: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
      occurred_at: ranAt.toISOString(),
      device_precheck: { ...precheck, lines: ["MARIA"] },
    });
    // The text read never goes: a payload carrying it is not a payload.
    expect(legacy.success).toBe(false);
  });
});

describe("the binding to the photo", () => {
  const proof: StoredPrecheck = {
    photoUri: "file:///draft/canhoto-1.jpg",
    mileage: null,
    result: precheckResult({ ...run, kind: "proof" }, { invoice_number_found: false }),
  };
  const odometer: StoredPrecheck = {
    photoUri: "file:///draft/odometro.jpg",
    mileage: 45210,
    result: precheckResult({ ...run, kind: "odometer" }, { typed_mileage_found: true }),
  };

  it("sends the check of the photo being sent, as overridden after a warning", () => {
    expect(precheckForSubmit(proof, proof.photoUri)).toEqual({
      ...proof.result,
      driver_overrode: true,
    });
    expect(precheckForSubmit(odometer, odometer.photoUri, 45210)).toEqual({
      ...odometer.result,
      driver_overrode: false,
    });
  });

  it("drops it when the photo was taken again, or the km typed again", () => {
    expect(precheckForSubmit(proof, "file:///draft/canhoto-2.jpg")).toBeUndefined();
    expect(precheckForSubmit(proof, null)).toBeUndefined();
    expect(precheckForSubmit(null, proof.photoUri)).toBeUndefined();
    expect(precheckForSubmit(odometer, odometer.photoUri, 45211)).toBeUndefined();
    expect(precheckApplies(odometer, odometer.photoUri, 45210)).toBe(true);
  });

  it("comes back from a draft only when well-formed", () => {
    expect(storedPrecheckOf(JSON.parse(JSON.stringify(proof)))).toEqual(proof);
    expect(storedPrecheckOf({ ...proof, result: { ...proof.result, outcome: "maybe" } })).toBeNull();
    expect(storedPrecheckOf({ result: proof.result })).toBeNull();
    expect(storedPrecheckOf("x")).toBeNull();
  });

  it("survives in the proof draft, and is dropped with a recovered new photo", () => {
    const revived = reviveProofDraft(
      {
        submissionId: "s-1",
        photo: { uri: proof.photoUri, fileName: "c.jpg", fileSize: 1, mimeType: "image/jpeg" },
        precheck: proof,
      } as never,
      () => true,
    );

    expect(revived?.precheck).toEqual(proof);

    const recovered = withRecoveredPhoto(
      "delivery-proof",
      revived,
      "s-1",
      { uri: "file:///draft/canhoto-2.jpg", fileName: "c2.jpg", fileSize: 1, mimeType: "image/jpeg" },
      ranAt.toISOString(),
    );

    expect((recovered as { precheck?: unknown }).precheck).toBeUndefined();
  });
});

describe("the queued proof", () => {
  const precheck = precheckResult({ ...run, kind: "proof" }, { invoice_number_found: true });
  const type = {
    id: "type-1",
    name: "Entrega normal",
    category: "DELIVERED",
    requires_receipt_photo: true,
    requires_signature: false,
    requires_photo: false,
    requires_authorization: false,
    form_fields: null,
    form_version: 1,
  };
  const item = (body: Record<string, unknown>) => ({
    id: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
    createdAt: ranAt.toISOString(),
    body: {
      client_submission_id: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
      occurrenceTypeId: "type-1",
      occurred_at: ranAt.toISOString(),
      form_version: 1,
      ...body,
    },
    photos: [{ uri: "file:///queue/c.jpg", fieldName: "receipt_photo" }],
  });

  it("keeps the pre-check of the same receipt when revised after a refusal", () => {
    const revised = revisedDeliveredBody(item({ device_precheck: precheck }) as never, {
      type: type as never,
      answers: {},
    });

    expect(revised.device_precheck).toEqual(precheck);
  });

  it("revises an item queued before the pre-check, without inventing one", () => {
    const revised = revisedDeliveredBody(item({}) as never, { type: type as never, answers: {} });

    expect(revised.device_precheck).toBeUndefined();
  });

  it("reads an old outbox item without the field as before", () => {
    const old = { id: "x", kind: "delivery-delivered", body: { client_submission_id: "x" } };

    expect(upcastOutboxItem(old).body).toEqual({ client_submission_id: "x" });
  });
});

describe("the warnings", () => {
  const proofResult = (check: Record<string, unknown>) =>
    precheckResult({ ...run, kind: "proof" }, check);

  it("names the invoice number, formatted as on the paper", () => {
    expect(proofWarning(proofResult({ invoice_number_found: false }), "000123456")).toBe(
      "O número da NF 123.456 não aparece na foto. Confira se fotografou o canhoto desta entrega.",
    );
    expect(proofWarning(proofResult({ invoice_number_found: true, date_out_of_window: true }))).toBe(
      "A data de recebimento na foto não é a de hoje. Confira se fotografou o canhoto desta entrega.",
    );
  });

  it("names the typed km", () => {
    expect(
      odometerWarning(
        precheckResult({ ...run, kind: "odometer" }, { typed_mileage_found: false }),
        45210,
      ),
    ).toBe("A km 45.210 não aparece na foto do odômetro. Confira o número digitado.");
  });

  it("shows nothing when all is fine, in doubt, failed, or of the other kind", () => {
    expect(proofWarning(proofResult({ invoice_number_found: true }))).toBeNull();
    expect(proofWarning(proofResult({ invoice_number_found: null }))).toBeNull();
    expect(proofWarning(precheckFailure({ ...run, kind: "proof" }))).toBeNull();
    expect(
      proofWarning(precheckResult({ ...run, kind: "odometer" }, { typed_mileage_found: false })),
    ).toBeNull();
    expect(proofWarning(null)).toBeNull();
  });
});

describe("evaluatePrecheck (the native reader replaced by a fake)", () => {
  const input = {
    kind: "proof" as const,
    photoUri: "file:///draft/canhoto.jpg",
    invoiceNumber: "45181",
    businessDay: "2026-09-27",
  };

  it("turns the read into the stored result, with the native time", async () => {
    const outcome = await evaluatePrecheck(
      {
        engineVersion: "16.0.1",
        readText: async () => ({
          durationMs: 380,
          blocks: [{ lines: [{ text: "N° 000.045.181" }, { text: "DATA DE RECEBIMENTO" }, { text: "27/09/2026" }] }],
        }),
      },
      input,
      { now: () => ranAt },
    );

    expect(outcome.failure).toBeNull();
    expect(outcome.stored).toMatchObject({
      photoUri: input.photoUri,
      mileage: null,
      result: { outcome: "ok", invoice_number_found: true, date_out_of_window: false, duration_ms: 380 },
    });
  });

  it("is an 'error' result when the native module fails", async () => {
    const outcome = await evaluatePrecheck(
      {
        engineVersion: "16.0.1",
        readText: async () => {
          throw new Error("ERR_TEXT_READER_IMAGE");
        },
      },
      input,
    );

    expect(outcome.stored.result.outcome).toBe("error");
    expect(outcome.failure).toBe("ERR_TEXT_READER_IMAGE");
  });

  it("gives up on a reader that hangs, and the flow goes on", async () => {
    const outcome = await evaluatePrecheck(
      { engineVersion: "16.0.1", readText: () => new Promise(() => undefined) },
      { ...input, kind: "odometer", mileage: 45210 },
      { timeoutMs: 20 },
    );

    expect(outcome.stored).toMatchObject({ mileage: 45210, result: { outcome: "error" } });
    expect(outcome.failure).toBe("PrecheckTimeoutError");
  });

  it("withTimeout resolves in time and rejects late", async () => {
    await expect(withTimeout(Promise.resolve(1), 50)).resolves.toBe(1);
    await expect(withTimeout(new Promise(() => undefined), 5)).rejects.toBeInstanceOf(
      PrecheckTimeoutError,
    );
  });
});
