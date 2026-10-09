import { describe, expect, it } from "vitest";

import {
  reviveOccurrenceDraft,
  reviveProofDraft,
  screenOfTarget,
  withRecoveredPhoto,
} from "@/features/deliveries/delivery-draft-rules";

/**
 * Edges of the delivery draft rules that the recovery flow tests do not reach
 * (mutation survivors of 06/10): a stored draft with missing or foreign-typed
 * fields, and a recovered camera photo merged into no draft or a full one.
 */

const always = () => true;
const photo = { uri: "file:///camera/new.jpg", fileName: "new.jpg" };
const NOW = "2026-10-06T12:00:00.000Z";
const EPOCH = new Date(0).toISOString();

describe("reviveProofDraft", () => {
  it("drops a draft without a string submission id", () => {
    expect(reviveProofDraft({ receivedBy: "Ana" }, always)).toBeNull();
    expect(reviveProofDraft({ submissionId: 42 as unknown as string }, always)).toBeNull();
  });

  it("blanks a non-string receiver and keeps a string one", () => {
    const foreign = reviveProofDraft(
      { submissionId: "s1", receivedBy: 7 as unknown as string },
      always,
    );
    expect(foreign?.receivedBy).toBe("");

    expect(reviveProofDraft({ submissionId: "s1", receivedBy: "Ana" }, always)?.receivedBy).toBe(
      "Ana",
    );
  });

  it("dates a draft without updatedAt at the epoch and keeps a stored one", () => {
    expect(reviveProofDraft({ submissionId: "s1" }, always)?.updatedAt).toBe(EPOCH);
    expect(reviveProofDraft({ submissionId: "s1", updatedAt: NOW }, always)?.updatedAt).toBe(NOW);
  });
});

describe("reviveOccurrenceDraft", () => {
  it("drops a draft without a string submission id", () => {
    expect(reviveOccurrenceDraft({ occurrenceTypeId: "t1" }, always)).toBeNull();
  });

  it("keeps string type and description, blanks foreign ones", () => {
    const kept = reviveOccurrenceDraft(
      { submissionId: "s1", occurrenceTypeId: "t1", description: "Portão fechado" },
      always,
    );
    expect(kept).toMatchObject({ occurrenceTypeId: "t1", description: "Portão fechado" });

    const foreign = reviveOccurrenceDraft(
      {
        submissionId: "s1",
        occurrenceTypeId: 3 as unknown as string,
        description: { text: "x" } as unknown as string,
      },
      always,
    );
    expect(foreign).toMatchObject({ occurrenceTypeId: "", description: "" });
  });

  it("dates a draft without updatedAt at the epoch and keeps a stored one", () => {
    expect(reviveOccurrenceDraft({ submissionId: "s1" }, always)?.updatedAt).toBe(EPOCH);
    expect(reviveOccurrenceDraft({ submissionId: "s1", updatedAt: NOW }, always)?.updatedAt).toBe(
      NOW,
    );
  });
});

describe("withRecoveredPhoto", () => {
  it("builds an empty proof around the photo when there was no draft", () => {
    expect(withRecoveredPhoto("delivery-proof", null, "s1", photo, NOW)).toEqual({
      submissionId: "s1",
      photo,
      signature: null,
      receivedBy: "",
      typeId: null,
      photos: [],
      answers: undefined,
      description: "",
      updatedAt: NOW,
    });
  });

  it("keeps everything the driver had in the proof except the photo", () => {
    const signature = { uri: "file:///sig.png" };
    const extra = { uri: "file:///extra.jpg" };
    const existing = {
      submissionId: "old",
      photo: { uri: "file:///old.jpg" },
      signature,
      receivedBy: "Ana",
      typeId: "type-1",
      photos: [extra],
      answers: { volumes: "3" },
      description: "Na portaria",
      updatedAt: "2026-10-05T10:00:00.000Z",
    };

    expect(withRecoveredPhoto("delivery-proof", existing, "s1", photo, NOW)).toEqual({
      submissionId: "s1",
      photo,
      signature,
      receivedBy: "Ana",
      typeId: "type-1",
      photos: [extra],
      answers: { volumes: "3" },
      description: "Na portaria",
      updatedAt: NOW,
    });
  });

  it("builds an empty occurrence around the photo when there was no draft", () => {
    expect(withRecoveredPhoto("delivery-occurrence", null, "s1", photo, NOW)).toEqual({
      submissionId: "s1",
      photo,
      occurrenceTypeId: "",
      description: "",
      answers: {},
      updatedAt: NOW,
    });
  });

  it("keeps the occurrence type, text and answers already typed", () => {
    const existing = {
      submissionId: "old",
      occurrenceTypeId: "t1",
      description: "Cliente ausente",
      photo: null,
      answers: { tentativa: "2" },
      updatedAt: "2026-10-05T10:00:00.000Z",
    };

    expect(withRecoveredPhoto("delivery-occurrence", existing, "s1", photo, NOW)).toEqual({
      submissionId: "s1",
      photo,
      occurrenceTypeId: "t1",
      description: "Cliente ausente",
      answers: { tentativa: "2" },
      updatedAt: NOW,
    });
  });
});

describe("screenOfTarget", () => {
  it("routes each draft kind to its own screen", () => {
    expect(screenOfTarget({ kind: "delivery-proof", businessId: "b", deliveryId: "d" })).toBe(
      "/delivery-proof",
    );
    expect(
      screenOfTarget({ kind: "delivery-occurrence", businessId: "b", deliveryId: "d" }),
    ).toBe("/delivery-occurrence");
  });
});
