import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";
import { describePendingItem } from "@/features/submissions/pending-item-rules";
import { OccurrenceFormError } from "@/features/occurrences/occurrence-form";
import { normalizeFormFields } from "@/features/occurrences/occurrence-form-rules";
import { authorizationView } from "@/features/occurrences/authorization-rules";

/**
 * An occurrence the queue could not deliver because of its FORM (contract §6
 * and §7): never dropped, shown to the driver with the fix, and sent again as
 * the same submission once answered.
 *
 * The real `outbox.ts` runs over an in-memory disk and a fake API (as in
 * outbox-pause-onway.test.ts). Before: a 409 OCCURRENCE_FORM_OUTDATED failed
 * the item with "Tentar de novo", which resent the same stale answers into
 * the same 409 forever, and an old build's report refused with
 * CLIENT_OUTDATED told an already-updated driver to update the app.
 */

// ---------------------------------------------------------------- natives
const disk = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: async (key: string, value: string) => void disk.set(key, value),
    removeItem: async (key: string) => void disk.delete(key),
  },
}));

vi.mock("expo-file-system", () => {
  class Directory {
    exists = false;
    create() {}
    delete() {}
  }

  return { Directory, File: class {}, Paths: { document: "doc" } };
});

vi.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));

const invalidated: unknown[][] = [];
const cache = new Map<string, unknown>();

vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
      invalidated.push(queryKey);
      return Promise.resolve();
    },
    setQueryData: (key: unknown[], update: (old: unknown) => unknown) => {
      cache.set(JSON.stringify(key), update(cache.get(JSON.stringify(key))));
    },
  },
}));

const uploads: string[] = [];

// A photo that already reached storage is not sent again: its key goes back.
vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: class UploadError extends Error {},
  uploadToStorage: async ({
    entries,
  }: {
    entries: Array<{ file: { uri: string }; uploadedKey?: string; fieldName?: string }>;
  }) =>
    entries.map((entry) => {
      if (!entry.uploadedKey) uploads.push(entry.file.uri);

      return { key: entry.uploadedKey ?? `fresh:${entry.file.uri}`, fieldName: entry.fieldName };
    }),
}));

type Sent = { endpoint: string; body: Record<string, unknown>; headers: Record<string, string> };

const sent: Sent[] = [];
const request = vi.fn();

vi.mock("@/utils/api", async () => {
  const { ApiError: RealApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>("@/utils/api-error");

  return {
    ApiError: RealApiError,
    apiClient: {
      request: async (
        endpoint: string,
        config: { body: Record<string, unknown>; headers: Record<string, string> },
      ) => {
        sent.push({ endpoint, body: config.body, headers: config.headers });
        return request(endpoint, config);
      },
    },
  };
});

const STORAGE_KEY = "@trajetto:outbox:v1";

let outbox: typeof import("@/features/submissions/outbox");
let review: typeof import("@/features/occurrences/occurrence-review");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
  review = await import("@/features/occurrences/occurrence-review");
});

const ITEM_ID = "7f1c2a4e-3b5c-4d6e-8f90-1a2b3c4d5e6f";
const ENDPOINT = "/delivery/report-occurrence/delivery-1/business/business-1";
const TAPPED = "2026-09-29T15:02:11.000Z";

/** A report queued in a dead zone by this build (version 3 of the form). */
function occurrenceItem(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    kind: "delivery-occurrence",
    businessId: "business-1",
    ownerUserId: "user-a",
    vehicleLabel: "Entrega para Mercado Central",
    endpoint: ENDPOINT,
    body: {
      client_submission_id: ITEM_ID,
      occurrenceTypeId: "type-ausente",
      occurred_at: TAPPED,
      latitude: -15.6,
      longitude: -56.1,
      form_answers: { quem_atendeu: "Porteiro" },
      form_version: 3,
    },
    photos: [
      {
        uri: "file:///doc/trajetto-outbox/item/foto.jpg",
        fileName: "foto.jpg",
        fileSize: 10,
        mimeType: "image/jpeg",
        uploadedKey: "deliveryPhotos/business-1/foto.jpg",
      },
    ],
    uploadType: "deliveryPhotos",
    photoField: "photo-keys",
    createdAt: "2026-09-29T15:02:12.000Z",
    attempts: 0,
    nextAttemptAt: 0,
    status: "pending",
    ...overrides,
  };
}

/** Version 4: a required question was added after the phone cached version 3. */
const CURRENT_FORM = {
  fields: normalizeFormFields([
    { key: "quem_atendeu", label: "Quem atendeu", type: "text", required: true },
    { key: "volumes", label: "Volumes", type: "number", required: true, integer: true },
  ]),
  version: 4,
};

const refusal = (code: string, status: number) =>
  new ApiError("Recusado pela API.", status, "Refused", "HTTP", code);

function onDisk(): Array<Record<string, unknown>> {
  return JSON.parse(disk.get(STORAGE_KEY) ?? "[]");
}

function queue(...items: Array<Record<string, unknown>>) {
  disk.set(STORAGE_KEY, JSON.stringify(items));
}

// Seen with the report's own company selected (a review is offered only there).
const viewOf = (item: Record<string, unknown>) =>
  describePendingItem(item as unknown as Parameters<typeof describePendingItem>[0], "own", Date.now(), {
    businessId: "business-1",
  });

beforeEach(() => {
  disk.clear();
  sent.length = 0;
  uploads.length = 0;
  invalidated.length = 0;
  cache.clear();
  request.mockReset();

  setSubmissionOwner("user-a");
});

describe("a report refused because its form changed (409 OCCURRENCE_FORM_OUTDATED)", () => {
  it("stays on the phone, whole, marked with the refusal", async () => {
    queue(occurrenceItem());
    request.mockRejectedValueOnce(refusal("OCCURRENCE_FORM_OUTDATED", 409));

    await outbox.processOutbox();

    const [kept] = onDisk();

    expect(kept).toMatchObject({
      id: ITEM_ID,
      status: "failed",
      failureCode: "OCCURRENCE_FORM_OUTDATED",
      body: occurrenceItem().body,
    });
    expect((kept.photos as Array<{ uploadedKey?: string }>)[0].uploadedKey).toBe(
      "deliveryPhotos/business-1/foto.jpg",
    );
  });

  it("is offered for review, not for a resend that would meet the same refusal", async () => {
    queue(occurrenceItem());
    request.mockRejectedValueOnce(refusal("OCCURRENCE_FORM_OUTDATED", 409));

    await outbox.processOutbox();

    expect(viewOf(onDisk()[0])).toEqual({
      tone: "warning",
      message:
        "O formulário deste tipo de ocorrência mudou. Revise as respostas e envie de novo: o que você já preencheu foi mantido.",
      canDiscard: true,
      retryLabel: null,
      isExpired: false,
      reviewLabel: "Revisar formulário",
    });
  });

  it("answered again, goes out as the SAME submission with the new version, photo and all", async () => {
    queue(occurrenceItem());
    request.mockRejectedValueOnce(refusal("OCCURRENCE_FORM_OUTDATED", 409));

    await outbox.processOutbox();

    const [failed] = onDisk();

    request.mockResolvedValueOnce({
      message: "Ocorrência registrada. Aguardando autorização da torre.",
      data: { id: "occ-1", authorization_status: "PENDING", replayed: false },
    });

    const revised = await review.reviseQueuedOccurrence(
      failed as unknown as Parameters<typeof review.reviseQueuedOccurrence>[0],
      {
        businessId: "business-1",
        occurrenceTypeId: "type-ausente",
        description: " Portão  fechado ",
        form: CURRENT_FORM,
        answers: { quem_atendeu: "Porteiro", volumes: "2" },
      },
    );

    expect(revised).toBe(true);

    // The pass the revision started.
    await outbox.processOutbox();

    const resend = sent.at(-1)!;

    expect(resend.endpoint).toBe(ENDPOINT);
    expect(resend.headers["Idempotency-Key"]).toBe(ITEM_ID);
    expect(resend.body).toEqual({
      client_submission_id: ITEM_ID,
      occurrenceTypeId: "type-ausente",
      // What happened at the stop is kept as it was sent the first time.
      occurred_at: TAPPED,
      latitude: -15.6,
      longitude: -56.1,
      description: "Portão fechado",
      form_answers: { quem_atendeu: "Porteiro", volumes: 2 },
      form_version: 4,
      photos: ["deliveryPhotos/business-1/foto.jpg"],
    });

    // The photo had reached storage; it is not sent again.
    expect(uploads).toEqual([]);

    expect(onDisk()).toEqual([]);
    expect(invalidated).toContainEqual(["my-deliveries", "business-1"]);
  });

  it("answers that still do not fit are refused on the phone; the item stays as it was", async () => {
    queue(occurrenceItem({ status: "failed", failureCode: "OCCURRENCE_FORM_OUTDATED" }));

    await expect(
      review.reviseQueuedOccurrence(
        occurrenceItem() as unknown as Parameters<typeof review.reviseQueuedOccurrence>[0],
        {
          businessId: "business-1",
          occurrenceTypeId: "type-ausente",
          form: CURRENT_FORM,
          answers: { quem_atendeu: "Porteiro" },
        },
      ),
    ).rejects.toBeInstanceOf(OccurrenceFormError);

    expect(onDisk()[0]).toMatchObject({
      status: "failed",
      failureCode: "OCCURRENCE_FORM_OUTDATED",
      body: occurrenceItem().body,
    });
    expect(sent).toEqual([]);
  });
});

describe("a report queued by a build before forms (400 CLIENT_OUTDATED)", () => {
  const oldBuildItem = () =>
    occurrenceItem({
      body: {
        client_submission_id: ITEM_ID,
        occurrenceTypeId: "type-ausente",
        occurred_at: TAPPED,
      },
      photos: [],
    });

  it("asks the updated driver to answer the form, not to update the app", async () => {
    queue(oldBuildItem());
    request.mockRejectedValueOnce(refusal("CLIENT_OUTDATED", 400));

    await outbox.processOutbox();

    const [kept] = onDisk();

    expect(kept).toMatchObject({ status: "failed", failure: "contract", failureCode: "CLIENT_OUTDATED" });
    expect(viewOf(kept)).toMatchObject({
      tone: "warning",
      message:
        "Este tipo de ocorrência agora tem perguntas. Responda o formulário para enviar o registro.",
      retryLabel: null,
      reviewLabel: "Responder formulário",
    });
  });

  it("answered, carries form_version for the first time", async () => {
    queue(oldBuildItem());
    request.mockRejectedValueOnce(refusal("CLIENT_OUTDATED", 400));

    await outbox.processOutbox();

    request.mockResolvedValueOnce({ data: { id: "occ-1", authorization_status: "NOT_REQUIRED" } });

    await review.reviseQueuedOccurrence(
      onDisk()[0] as unknown as Parameters<typeof review.reviseQueuedOccurrence>[0],
      {
        businessId: "business-1",
        occurrenceTypeId: "type-ausente",
        form: CURRENT_FORM,
        answers: { quem_atendeu: "Porteiro", volumes: "1" },
      },
    );

    await outbox.processOutbox();

    expect(sent.at(-1)!.body).toMatchObject({
      client_submission_id: ITEM_ID,
      occurred_at: TAPPED,
      form_answers: { quem_atendeu: "Porteiro", volumes: 1 },
      form_version: 4,
    });
    expect(onDisk()).toEqual([]);
  });
});

describe("the other refusals keep their own reading", () => {
  it("a type switched off offers another type", async () => {
    queue(occurrenceItem());
    request.mockRejectedValueOnce(refusal("OCCURRENCE_TYPE_INACTIVE", 400));

    await outbox.processOutbox();

    expect(viewOf(onDisk()[0])).toMatchObject({ reviewLabel: "Escolher outro tipo" });
  });

  it("a delivery that is gone is a plain failure: no review, the driver decides", async () => {
    queue(occurrenceItem());
    request.mockRejectedValueOnce(refusal("DELIVERY_NOT_FOUND", 404));

    await outbox.processOutbox();

    const view = viewOf(onDisk()[0]);

    expect(view.reviewLabel).toBeUndefined();
    expect(view).toMatchObject({ tone: "danger", retryLabel: "Tentar de novo", canDiscard: true });
  });

  it("a code on another kind is not an occurrence review", () => {
    expect(
      viewOf({
        kind: "delivery-proof",
        createdAt: new Date().toISOString(),
        status: "failed",
        attempts: 1,
        failureCode: "OCCURRENCE_FORM_OUTDATED",
      }).reviewLabel,
    ).toBeUndefined();
  });

  it("a network failure is only retried, and records no code", async () => {
    queue(occurrenceItem());
    request.mockRejectedValueOnce(new ApiError("Sem rede", 0, "Network Error", "NETWORK"));

    await outbox.processOutbox();

    expect(onDisk()[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(onDisk()[0].failureCode).toBeUndefined();
  });
});

describe("what a revision may touch", () => {
  const body = { client_submission_id: ITEM_ID, occurrenceTypeId: "x", occurred_at: TAPPED, form_version: 9 };

  it("not an item that is still on its way", async () => {
    queue(occurrenceItem());

    await expect(outbox.reviseOutboxItem(ITEM_ID, body)).resolves.toBe(false);
    expect(onDisk()[0].body).toEqual(occurrenceItem().body);
  });

  it("not another driver's", async () => {
    queue(occurrenceItem({ status: "failed", ownerUserId: "user-b" }));

    await expect(outbox.reviseOutboxItem(ITEM_ID, body)).resolves.toBe(false);
    expect(onDisk()[0].body).toEqual(occurrenceItem().body);
  });

  it("not without a session", async () => {
    queue(occurrenceItem({ status: "failed" }));
    setSubmissionOwner(null);

    await expect(outbox.reviseOutboxItem(ITEM_ID, body)).resolves.toBe(false);
    expect(onDisk()[0].status).toBe("failed");
  });

  // A driver of two companies reviewing company 1's report while company 2
  // is selected: the type and form come from company 2's catalog. Before,
  // the body went back in line and the API answered 404
  // OCCURRENCE_TYPE_NOT_FOUND — a refusal no review can fix, with one
  // tenant's catalog id in the other's request.
  it("not with a type and form read from another company's catalog", async () => {
    queue(occurrenceItem({ status: "failed", failureCode: "OCCURRENCE_TYPE_INACTIVE" }));

    await expect(
      review.reviseQueuedOccurrence(
        onDisk()[0] as unknown as Parameters<typeof review.reviseQueuedOccurrence>[0],
        {
          businessId: "business-2",
          occurrenceTypeId: "type-of-business-2",
          form: CURRENT_FORM,
          answers: { quem_atendeu: "Porteiro", volumes: "2" },
        },
      ),
    ).rejects.toThrow(
      "Este envio é de outra empresa e não pode ser revisado neste acesso: descarte-o ou fale com o gestor.",
    );

    await outbox.processOutbox();

    expect(onDisk()[0]).toMatchObject({
      status: "failed",
      failureCode: "OCCURRENCE_TYPE_INACTIVE",
      body: occurrenceItem().body,
    });
    expect(sent).toEqual([]);
  });
});

describe("a report the queue delivers later", () => {
  // Only Date: the queue's own timers run as they do on the phone.
  const SENT = "2026-09-29T15:30:00.000Z";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(SENT));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("that waits for the tower shows on the stop at once, even if the reread never lands", async () => {
    const LIST = JSON.stringify(["my-deliveries", "business-1"]);

    cache.set(LIST, {
      data: [{ id: "delivery-1", status: "IN_TRANSIT", authorization_request: null }],
      occurrence_types: [{ id: "type-ausente", name: "Cliente ausente" }],
    });

    queue(occurrenceItem());
    request.mockResolvedValueOnce({
      message: "Ocorrência registrada. Aguardando autorização da torre.",
      data: { id: "occ-7", authorization_status: "PENDING", replayed: false },
    });

    await outbox.processOutbox();

    expect(onDisk()).toEqual([]);
    expect(
      (cache.get(LIST) as { data: Array<{ authorization_request: unknown }> }).data[0]
        .authorization_request,
    ).toEqual({
      occurrenceId: "occ-7",
      occurrenceTypeId: "type-ausente",
      occurrenceTypeName: "Cliente ausente",
      status: "PENDING",
      note: null,
      decidedAt: null,
      // When the API took it, as its own requestedAt (created_at) says —
      // not the tap, half an hour earlier in the dead zone.
      requestedAt: SENT,
    });
  });

  // Before: the request was dated by the tap (15:02), lost to an older
  // report of the stop queued at 15:10 and still failed, and the stop said
  // "Ocorrência não enviada" — until the reread brought the server's 15:30
  // and it flipped to "Aguardando autorização da torre" with no new event.
  it("is dated by the send, so the stop says the same before and after the reread", async () => {
    const LIST = JSON.stringify(["my-deliveries", "business-1"]);
    const TYPES = [{ id: "type-ausente", name: "Cliente ausente", requires_authorization: true }];

    cache.set(LIST, {
      data: [{ id: "delivery-1", status: "IN_TRANSIT", authorization_request: null }],
      occurrence_types: TYPES,
    });

    const failedInBetween = occurrenceItem({
      id: "0a0b0c0d-1111-4222-8333-444455556666",
      body: { ...occurrenceItem().body, client_submission_id: "0a0b0c0d-1111-4222-8333-444455556666" },
      createdAt: "2026-09-29T15:10:00.000Z",
      status: "failed",
      failureCode: "OCCURRENCE_FORM_OUTDATED",
    });

    queue(occurrenceItem(), failedInBetween);
    request.mockResolvedValueOnce({
      data: { id: "occ-9", authorization_status: "PENDING", replayed: false },
    });

    await outbox.processOutbox();

    const day = cache.get(LIST) as {
      data: Array<Parameters<typeof authorizationView>[0]["delivery"]>;
    };
    const stop = () =>
      authorizationView({
        delivery: day.data[0],
        queue: onDisk() as unknown as Parameters<typeof authorizationView>[0]["queue"],
        occurrenceTypes: TYPES,
      });

    expect(onDisk()).toHaveLength(1);
    expect(stop()).toMatchObject({
      tone: "waiting",
      title: "Aguardando autorização da torre",
      secondary: "Uma ocorrência anterior não foi enviada: veja em Envios pendentes.",
    });

    // The reread brings the server's date for the same request: no change.
    const reread = {
      ...day.data[0],
      authorization_request: {
        ...day.data[0].authorization_request!,
        requestedAt: "2026-09-29T15:30:01.000Z",
      },
    };

    expect(
      authorizationView({
        delivery: reread,
        queue: onDisk() as unknown as Parameters<typeof authorizationView>[0]["queue"],
        occurrenceTypes: TYPES,
      }),
    ).toEqual(stop());
  });

  it("that needed no authorization leaves the stop to the reread", async () => {
    const LIST = JSON.stringify(["my-deliveries", "business-1"]);
    const day = {
      data: [{ id: "delivery-1", status: "IN_TRANSIT", authorization_request: null }],
      occurrence_types: [],
    };

    cache.set(LIST, day);
    queue(occurrenceItem());
    request.mockResolvedValueOnce({ data: { id: "occ-8", authorization_status: "NOT_REQUIRED" } });

    await outbox.processOutbox();

    expect(cache.get(LIST)).toBe(day);
    expect(invalidated).toContainEqual(["my-deliveries", "business-1"]);
  });
});
