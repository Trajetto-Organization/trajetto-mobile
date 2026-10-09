import { describe, expect, it } from "vitest";

import {
  deliveryArrivalBodySchema,
  deliveryOccurrenceBodySchema,
  deliveryOccurrenceFormSchema,
  deliveryProofBodySchema,
  deliveryProofFormSchema,
} from "@/schemas/delivery";

import {
  hasInlineConsecutiveSpaces,
  hasSpaceAtLineEdges,
  normalizeMultilineText,
  normalizeSingleLineText,
} from "@/schemas/text-rules";

/**
 * The API's text rules, on the phone, before the offline queue.
 *
 * A proof or an occurrence recorded in a dead zone is sent hours later; a 400
 * then is a permanent failure the driver can only discard (DLV-ST-2,
 * DLVP-OCC-2). These are the API's own limits and messages, and — for the
 * multiline description — decision 5.5: line breaks may repeat, spaces may
 * not.
 */
const SUBMISSION_ID = "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01";
const TAPPED = "2026-09-28T10:05:00.000Z";

const firstMessage = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }) =>
  result.success ? null : result.error?.issues[0]?.message;

describe("single-line text: Quem recebeu", () => {
  it("normalizes what a phone keyboard leaves behind", () => {
    expect(normalizeSingleLineText("  João   Silva ")).toBe("João Silva");
    expect(normalizeSingleLineText("João  Silva")).toBe("João Silva");
    expect(normalizeSingleLineText("João\nSilva")).toBe("João Silva");
    expect(normalizeSingleLineText("   ")).toBe("");
  });

  it("refuses what the API refuses, with the API's words", () => {
    expect(
      firstMessage(deliveryProofFormSchema.safeParse({ receivedBy: "João  Silva" })),
    ).toBe("O nome de quem recebeu não deve conter espaços consecutivos.");

    expect(
      firstMessage(deliveryProofFormSchema.safeParse({ receivedBy: " João" })),
    ).toBe(
      "O nome de quem recebeu não pode começar ou terminar com espaço em branco.",
    );

    expect(
      firstMessage(
        deliveryProofFormSchema.safeParse({ receivedBy: "a".repeat(151) }),
      ),
    ).toBe("O nome de quem recebeu deve ter no máximo 150 caracteres.");
  });

  it("stays optional in the app (decision 5.3)", () => {
    expect(deliveryProofFormSchema.safeParse({ receivedBy: "" }).success).toBe(true);
    expect(deliveryProofFormSchema.safeParse({}).success).toBe(true);
    expect(
      deliveryProofFormSchema.safeParse({ receivedBy: "a".repeat(150) }).success,
    ).toBe(true);
  });
});

describe("multiline text: the occurrence description (decision 5.5)", () => {
  it("accepts repeated line breaks — two paragraphs are not a typo", () => {
    const text = "Cliente ausente.\n\nVizinho informou que volta às 18h.";

    expect(hasInlineConsecutiveSpaces(text)).toBe(false);
    expect(
      deliveryOccurrenceFormSchema.safeParse({
        occurrenceTypeId: "type-1",
        description: text,
      }).success,
    ).toBe(true);
  });

  it("still refuses two spaces in a row, and spaces at the edges of a line", () => {
    expect(
      firstMessage(
        deliveryOccurrenceFormSchema.shape.description.safeParse("Portão  fechado"),
      ),
    ).toBe("A descrição não deve conter espaços consecutivos.");

    expect(hasSpaceAtLineEdges("Portão fechado \nsem campainha")).toBe(true);
    expect(
      firstMessage(
        deliveryOccurrenceFormSchema.shape.description.safeParse(
          "Portão fechado \nsem campainha",
        ),
      ),
    ).toBe("A descrição não pode começar ou terminar com espaço em branco.");

    expect(
      firstMessage(
        deliveryOccurrenceFormSchema.shape.description.safeParse("a".repeat(501)),
      ),
    ).toBe("A descrição deve ter no máximo 500 caracteres.");
  });

  it("normalizes each line and keeps the breaks", () => {
    expect(
      normalizeMultilineText("  Portão   fechado \r\n\r\n  Vizinho  informou  "),
    ).toBe("Portão fechado\n\nVizinho informou");
  });

  it("requires the occurrence type", () => {
    expect(
      firstMessage(deliveryOccurrenceFormSchema.safeParse({ occurrenceTypeId: "" })),
    ).toBe("O tipo de ocorrência é obrigatório.");
  });
});

describe("the bodies that enter the queue", () => {
  it("an arrival needs a real place", () => {
    const body = {
      client_submission_id: SUBMISSION_ID,
      latitude: -23.55,
      longitude: -46.63,
      occurred_at: TAPPED,
    };

    expect(deliveryArrivalBodySchema.safeParse(body).success).toBe(true);

    // NaN travels as null in JSON — the API's 400, a permanent failure.
    expect(
      deliveryArrivalBodySchema.safeParse({ ...body, latitude: Number.NaN })
        .success,
    ).toBe(false);
    expect(
      deliveryArrivalBodySchema.safeParse({ ...body, longitude: 181 }).success,
    ).toBe(false);
    expect(
      deliveryArrivalBodySchema.safeParse({ ...body, client_submission_id: "x" })
        .success,
    ).toBe(false);
  });

  it("a proof drops an empty 'Quem recebeu' instead of sending it", () => {
    const parsed = deliveryProofBodySchema.parse({
      client_submission_id: SUBMISSION_ID,
      occurred_at: TAPPED,
      received_by: "",
    });

    expect(parsed).not.toHaveProperty("received_by", "");
    expect(JSON.parse(JSON.stringify(parsed))).toEqual({
      client_submission_id: SUBMISSION_ID,
      occurred_at: TAPPED,
    });
  });

  it("an occurrence refuses a description the API would refuse", () => {
    expect(
      deliveryOccurrenceBodySchema.safeParse({
        client_submission_id: SUBMISSION_ID,
        occurrenceTypeId: "type-1",
        occurred_at: TAPPED,
        description: "Portão  fechado",
      }).success,
    ).toBe(false);
  });
});
