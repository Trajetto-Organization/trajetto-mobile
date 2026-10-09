import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  categoryIssues,
  missingRequirements,
  type CategoryShape,
  type ReportAttachments,
  type ReportRequirements,
} from "@/features/deliveries/occurrence-category-rules";
import {
  DELIVERED_PENDING_LABEL,
  deliveredChoiceOf,
  deliveredFiles,
  deliveredMissing,
  deliveredRequestPending,
  deliveredSectionsOf,
  deliveredSentNotice,
  occurrenceFilesPayload,
} from "@/features/deliveries/delivered-requirements";
import { effectiveStopStatus } from "@/features/deliveries/on-the-way-rules";
import { reviveProofDraft } from "@/features/deliveries/delivery-draft-rules";
import { deliveredOccurrenceBodySchema } from "@/schemas/delivery";
import type { DriverOccurrenceType } from "@/features/deliveries/types";

/**
 * "Entregar" as a DELIVERED occurrence (decision 14.3; design §8.2–§8.3).
 *
 * The app refuses, BEFORE the offline queue, exactly what the API would: so
 * its category rules are the API's file (checked line for line) run over the
 * API's own shared cases, and what the screen adds — which flow, which
 * blocks, what goes in the body — is pinned here.
 */

const API = resolve(__dirname, "../../../trajetto-api");
const API_RULES = join(API, "src/modules/occurrence-type/rules/occurrence-category-rules.ts");
const API_CASES = join(API, "tests/unitaires/occurrence-type/fixtures/occurrence-requirements-cases.json");
const HAS_API = existsSync(API_RULES);

const APP_RULES = resolve(__dirname, "../../features/deliveries/occurrence-category-rules.ts");
// A copy of the API's shared cases, so they run wherever the app's tests run.
const APP_CASES = resolve(__dirname, "../fixtures/occurrence-requirements-cases.json");

/** The file without its leading doc comment (each copy says where it lives). */
function body(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/^\/\*\*[\s\S]*?\*\/\n/, "");
}

interface SharedCases {
  matrix: Array<{ name: string; shape: CategoryShape; issues: unknown[] }>;
  missing: Array<{ name: string; type: ReportRequirements; sent: ReportAttachments; missing: unknown[] }>;
}

const cases = JSON.parse(readFileSync(APP_CASES, "utf8")) as SharedCases;

describe.skipIf(!HAS_API)("parity with trajetto-api", () => {
  it("is the API's code, line for line, below the header", () => {
    expect(body(APP_RULES)).toBe(body(API_RULES));
  });

  it("runs the API's cases, not a stale copy of them", () => {
    expect(JSON.parse(readFileSync(APP_CASES, "utf8"))).toEqual(
      JSON.parse(readFileSync(API_CASES, "utf8")),
    );
  });
});

describe("the shared cases", () => {
  it.each(cases.matrix.map((entry) => [entry.name, entry] as const))("matrix: %s", (_name, entry) => {
    expect(categoryIssues(entry.shape)).toEqual(entry.issues);
  });

  it.each(cases.missing.map((entry) => [entry.name, entry] as const))("missing: %s", (_name, entry) => {
    expect(missingRequirements(entry.type, entry.sent)).toEqual(entry.missing);
  });
});

const type = (overrides: Partial<DriverOccurrenceType>): DriverOccurrenceType => ({
  id: "t-default",
  name: "Entrega normal",
  description: null,
  requires_photo: false,
  blocks_delivery: false,
  category: "DELIVERED",
  requires_receipt_photo: true,
  requires_signature: false,
  is_default: true,
  ...overrides,
});

describe("which flow Entregar takes", () => {
  it("keeps the legacy proof for a day cached before the types", () => {
    expect(deliveredChoiceOf(undefined)).toEqual({ mode: "legacy" });
    expect(deliveredChoiceOf([])).toEqual({ mode: "legacy" });
  });

  it("goes straight to the only type, and offers several with the default first", () => {
    const only = type({});
    const damaged = type({ id: "t-damage", name: "Entrega com avaria", is_default: false });

    expect(deliveredChoiceOf([only])).toEqual({ mode: "single", type: only });
    expect(deliveredChoiceOf([damaged, only])).toEqual({
      mode: "pick",
      types: [damaged, only],
      initial: only,
    });
  });
});

describe("what the screen asks for", () => {
  it("asks the legacy flow what the old screen asked", () => {
    expect(deliveredSectionsOf(null)).toEqual({
      receipt: "required",
      signature: "optional",
      photos: false,
    });
  });

  it("follows the type: optional receipt, required signature, extra photos", () => {
    expect(
      deliveredSectionsOf(
        type({ requires_receipt_photo: false, requires_signature: true, requires_photo: true }),
      ),
    ).toEqual({ receipt: "optional", signature: "required", photos: true });
  });

  it("refuses with the API's messages what the type requires and is missing", () => {
    const strict = type({ requires_signature: true, requires_photo: true });

    expect(
      deliveredMissing(strict, { receiptPhoto: false, signature: false, photos: 0 }).map(
        (entry) => entry.code,
      ),
    ).toEqual([
      "OCCURRENCE_RECEIPT_PHOTO_REQUIRED",
      "OCCURRENCE_SIGNATURE_REQUIRED",
      "OCCURRENCE_PHOTO_REQUIRED",
    ]);
    expect(deliveredMissing(strict, { receiptPhoto: true, signature: true, photos: 1 })).toEqual([]);
    expect(deliveredMissing(null, { receiptPhoto: false, signature: false, photos: 0 })[0]?.message).toBe(
      "Este tipo exige a foto do canhoto.",
    );
  });

  it("holds Entregar while this driver's delivery request waits for the tower", () => {
    const pending = {
      authorization_request: {
        occurrenceId: "o1",
        occurrenceTypeId: "t-tower",
        occurrenceTypeName: "Entrega com conferência",
        status: "PENDING" as const,
        note: null,
        decidedAt: null,
        requestedAt: "2026-10-05T12:00:00.000Z",
      },
    };

    expect(deliveredRequestPending(pending, [type({ id: "t-tower" })])).toBe(true);
    // A pending NOT-delivered request does not hold Entregar (6.3: the proof wins).
    expect(deliveredRequestPending(pending, [type({})])).toBe(false);
    expect(deliveredRequestPending({ authorization_request: null }, [type({})])).toBe(false);
    expect(DELIVERED_PENDING_LABEL).toBe("Entrega aguardando autorização");
  });
});

describe("what goes to the queue (photoField occurrence-files)", () => {
  it("names each file by the body field it fills, the receipt first", () => {
    expect(
      deliveredFiles({ receiptPhoto: "r.jpg", signature: "s.png", photos: ["a.jpg", "b.jpg"] }),
    ).toEqual([
      { file: "r.jpg", fieldName: "receipt_photo" },
      { file: "s.png", fieldName: "signature" },
      { file: "a.jpg", fieldName: "photos" },
      { file: "b.jpg", fieldName: "photos" },
    ]);
    expect(deliveredFiles({ receiptPhoto: null, signature: null, photos: [] })).toEqual([]);
  });

  it("puts the receipt and signature keys as strings and the photos as an array", () => {
    expect(
      occurrenceFilesPayload({ occurrenceTypeId: "t" }, [
        { key: "deliveryPhotos/r.jpg", fieldName: "receipt_photo" },
        { key: "deliveryPhotos/s.png", fieldName: "signature" },
        { key: "deliveryPhotos/a.jpg", fieldName: "photos" },
      ]),
    ).toEqual({
      occurrenceTypeId: "t",
      receipt_photo: "deliveryPhotos/r.jpg",
      signature: "deliveryPhotos/s.png",
      photos: ["deliveryPhotos/a.jpg"],
    });
    // Nothing uploaded: the body goes as it was.
    expect(occurrenceFilesPayload({ occurrenceTypeId: "t" }, [])).toEqual({ occurrenceTypeId: "t" });
  });

  it("takes who received in the report's body, with the proof's text rules", () => {
    const parsed = deliveredOccurrenceBodySchema.safeParse({
      client_submission_id: "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01",
      occurrenceTypeId: "t",
      occurred_at: "2026-10-05T12:00:00.000Z",
      form_version: 1,
      received_by: "Maria  Souza",
    });

    expect(parsed.success).toBe(false);
  });

  it("tells the driver a request waits for the tower", () => {
    expect(deliveredSentNotice("PENDING").message).toBe("Aguardando autorização da torre.");
    expect(deliveredSentNotice("NOT_REQUIRED").title).toBe("Entrega registrada!");
  });
});

describe("a queued delivery and the stop", () => {
  it("reads the stop as completed while the delivery waits in the queue", () => {
    const delivery = {
      id: "d1",
      stops: [{ id: "s1", status: "PENDING", route: { id: "r1", status: "IN_PROGRESS" } }],
    };

    expect(
      effectiveStopStatus(
        delivery as never,
        [
          {
            kind: "delivery-delivered",
            status: "pending",
            endpoint: "/delivery/report-occurrence/d1/business/b1",
            body: {},
            createdAt: "2026-10-05T12:00:00.000Z",
          },
        ],
        new Set(),
      ),
    ).toBe("COMPLETED");
  });
});

describe("the proof's draft", () => {
  it("comes back with the type, the extra photos and the answers, and without what is gone", () => {
    const draft = reviveProofDraft(
      {
        submissionId: "k1",
        photo: { uri: "file://r.jpg" },
        signature: null,
        receivedBy: "Maria",
        typeId: "t-damage",
        photos: [{ uri: "file://a.jpg" }, { uri: "file://gone.jpg" }],
        answers: { lacre: "123" },
        description: "Avaria na caixa",
      },
      (uri) => uri !== "file://gone.jpg",
    );

    expect(draft).toMatchObject({
      typeId: "t-damage",
      photos: [{ uri: "file://a.jpg" }],
      answers: { lacre: "123" },
      description: "Avaria na caixa",
    });
  });

  it("reads a draft from before the types as the legacy proof", () => {
    expect(reviveProofDraft({ submissionId: "k1" }, () => true)).toMatchObject({
      typeId: null,
      photos: [],
      description: "",
    });
  });
});
