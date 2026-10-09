import { describe, expect, it } from "vitest";

import {
  reviveOccurrenceDraft,
  withRecoveredPhoto,
  type OccurrenceDraft,
} from "@/features/deliveries/delivery-draft-rules";

/**
 * The occurrence draft keeps the form's answers (decision 6.2; MOB-12): the
 * app killed by a call, or by the camera, while the driver answered eight
 * questions at the door must not cost them the answers — only the photo is
 * expensive to redo, and the answers are what the tower reads.
 */

const exists = () => true;

describe("an occurrence draft read back", () => {
  it("brings the answers back as they were typed", () => {
    const restored = reviveOccurrenceDraft(
      {
        submissionId: "sub-1",
        occurrenceTypeId: "type-ausente",
        description: "Portão fechado",
        photo: null,
        answers: { quem_atendeu: "Porteiro", volumes: "2", ligou_cliente: false, nova_data: null },
        updatedAt: "2026-09-29T15:00:00.000Z",
      },
      exists,
    );

    expect(restored?.answers).toEqual({
      quem_atendeu: "Porteiro",
      volumes: "2",
      ligou_cliente: false,
      nova_data: null,
    });
  });

  it("a draft from before forms has none, and whatever an input cannot hold is dropped", () => {
    expect(
      reviveOccurrenceDraft({ submissionId: "sub-1", occurrenceTypeId: "t" }, exists)?.answers,
    ).toEqual({});

    expect(
      reviveOccurrenceDraft(
        { submissionId: "sub-1", answers: { a: 3, b: { x: 1 }, c: "ok" } as unknown as OccurrenceDraft["answers"] },
        exists,
      )?.answers,
    ).toEqual({ c: "ok" });
  });

  it("a photo recovered from the camera keeps the answers already given", () => {
    const existing: OccurrenceDraft = {
      submissionId: "sub-1",
      occurrenceTypeId: "type-ausente",
      description: "",
      photo: null,
      answers: { quem_atendeu: "Porteiro" },
      updatedAt: "2026-09-29T15:00:00.000Z",
    };

    const next = withRecoveredPhoto(
      "delivery-occurrence",
      existing,
      "sub-1",
      { uri: "file:///doc/trajetto-drafts/delivery-occurrence/sub-1/photo.jpg" },
      "2026-09-29T15:05:00.000Z",
    ) as OccurrenceDraft;

    expect(next.answers).toEqual({ quem_atendeu: "Porteiro" });
    expect(next.photo?.uri).toContain("photo.jpg");
  });
});
