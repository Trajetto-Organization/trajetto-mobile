import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setSubmissionOwner } from "@/features/submissions/submission-owner";
import {
  START_ROUTE_SEND_TTL_MS,
  isSendExpired,
} from "@/features/submissions/outbox-rules";

/**
 * The queue and the time of the fact (MOB-08).
 *
 * The body of a queued item is frozen at the tap, `occurred_at` included; the
 * queue adds, at each attempt, the instant it sends (`X-Client-Sent-At`). The
 * API uses only the difference between the two, so a phone whose clock is
 * wrong still reports the right hour. And a departure is not a proof: a
 * "Iniciar rota" still queued half a day later is sent to a day that has moved
 * on, so it stops being sent and asks the driver instead.
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

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries: async () => undefined },
}));

vi.mock("@/features/media/upload-to-storage", () => ({
  UploadError: class UploadError extends Error {},
  uploadToStorage: async ({
    entries,
  }: {
    entries: { uploadedKey?: string; fieldName?: string }[];
  }) =>
    entries.map((entry) => ({
      key: entry.uploadedKey ?? "fresh-key",
      fieldName: entry.fieldName,
    })),
}));

type Sent = {
  endpoint: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};

const sent: Sent[] = [];

vi.mock("@/utils/api", async () => {
  const { ApiError: RealApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>(
      "@/utils/api-error",
    );

  return {
    ApiError: RealApiError,
    apiClient: {
      request: async (
        endpoint: string,
        config: { body: Record<string, unknown>; headers: Record<string, string> },
      ) => {
        sent.push({ endpoint, body: config.body, headers: config.headers });

        return {};
      },
    },
  };
});

const STORAGE_KEY = "@trajetto:outbox:v1";

const HOUR = 60 * 60 * 1000;

let outbox: typeof import("@/features/submissions/outbox");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
});

const NOW = new Date("2026-09-24T13:40:00.000Z").getTime();

function queued(
  id: string,
  kind: string,
  createdAt: number,
  body: Record<string, unknown>,
) {
  return {
    id,
    kind,
    businessId: "business-1",
    ownerUserId: "user-a",
    vehicleLabel: "Entrega para Maria",
    endpoint: `/delivery/${kind}/business-1`,
    body,
    photos: [],
    uploadType: "deliveryPhotos",
    photoField: "photo",
    createdAt: new Date(createdAt).toISOString(),
    attempts: 0,
    nextAttemptAt: 0,
    status: "pending",
  };
}

function onDisk(): Array<Record<string, unknown>> {
  return JSON.parse(disk.get(STORAGE_KEY) ?? "[]");
}

beforeEach(() => {
  disk.clear();
  sent.length = 0;

  // Only the clock: the queue's own timers must keep running.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

  setSubmissionOwner("user-a");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a proof queued at the tap and sent hours later", () => {
  it("carries the tap in the body and the send in the header", async () => {
    const tappedAt = new Date(NOW - 3 * HOUR).toISOString();

    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        queued("proof-1", "delivery-proof", NOW - 3 * HOUR, {
          client_submission_id: "proof-1",
          occurred_at: tappedAt,
        }),
      ]),
    );

    await outbox.processOutbox();

    expect(sent).toHaveLength(1);

    // The tap, untouched by the delay.
    expect(sent[0].body.occurred_at).toBe(tappedAt);

    // The send, by the same clock, stamped now.
    expect(sent[0].headers["X-Client-Sent-At"]).toBe(
      new Date(NOW).toISOString(),
    );
    expect(onDisk()).toEqual([]);
  });

  it("is still sent half a day later: a proof never goes stale", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        queued("proof-2", "delivery-proof", NOW - 13 * HOUR, {
          client_submission_id: "proof-2",
        }),
      ]),
    );

    await outbox.processOutbox();

    expect(sent).toHaveLength(1);
    expect(onDisk()).toEqual([]);
  });
});

describe("a departure still queued half a day after the tap", () => {
  it("is not sent, and asks the driver instead", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        queued("start-1", "delivery-start-route", NOW - 13 * HOUR, {}),
      ]),
    );

    await outbox.processOutbox();

    expect(sent).toEqual([]);

    const [item] = onDisk();

    expect(item).toMatchObject({ id: "start-1", status: "failed" });
    expect(item.lastError).toMatch(/Iniciar rota/);
  });

  it("is sent while it is still the same shift", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        queued("start-2", "delivery-start-route", NOW - HOUR, {}),
      ]),
    );

    await outbox.processOutbox();

    expect(sent).toHaveLength(1);
    expect(onDisk()).toEqual([]);
  });
});

describe("isSendExpired", () => {
  const at = (ms: number) => new Date(ms).toISOString();

  it("expires only departures, and only after the TTL", () => {
    expect(
      isSendExpired(
        { kind: "delivery-start-route", createdAt: at(NOW - 13 * HOUR) },
        NOW,
      ),
    ).toBe(true);

    expect(
      isSendExpired(
        {
          kind: "delivery-start-route",
          createdAt: at(NOW - START_ROUTE_SEND_TTL_MS + 60_000),
        },
        NOW,
      ),
    ).toBe(false);

    for (const kind of ["delivery-proof", "delivery-arrival", "fuel", "checklist"]) {
      expect(isSendExpired({ kind, createdAt: at(NOW - 30 * 24 * HOUR) }, NOW)).toBe(
        false,
      );
    }
  });

  it("never expires an item whose creation time it cannot read", () => {
    expect(
      isSendExpired({ kind: "delivery-start-route", createdAt: "?" }, NOW),
    ).toBe(false);
  });
});

describe("a delivery registered through its type, queued (decision 14.3)", () => {
  it("is sent to the report with the receipt and the signature as strings and the photos as an array", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        {
          ...queued("delivered-1", "delivery-delivered", NOW - HOUR, {
            client_submission_id: "delivered-1",
            occurrenceTypeId: "type-default",
            form_version: 1,
          }),
          endpoint: "/delivery/report-occurrence/delivery-1/business/business-1",
          photoField: "occurrence-files",
          photos: [
            { uri: "file://r.jpg", fileName: "r.jpg", fileSize: 1, mimeType: "image/jpeg", fieldName: "receipt_photo", uploadedKey: "deliveryPhotos/r.jpg" },
            { uri: "file://s.png", fileName: "s.png", fileSize: 1, mimeType: "image/png", fieldName: "signature", uploadedKey: "deliveryPhotos/s.png" },
            { uri: "file://a.jpg", fileName: "a.jpg", fileSize: 1, mimeType: "image/jpeg", fieldName: "photos", uploadedKey: "deliveryPhotos/a.jpg" },
          ],
        },
      ]),
    );

    await outbox.processOutbox();

    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({
      occurrenceTypeId: "type-default",
      receipt_photo: "deliveryPhotos/r.jpg",
      signature: "deliveryPhotos/s.png",
      photos: ["deliveryPhotos/a.jpg"],
    });
    expect(onDisk()).toEqual([]);
  });
});
