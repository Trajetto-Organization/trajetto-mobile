import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { setSubmissionOwner } from "@/features/submissions/submission-owner";
import { isHurriableBy } from "@/features/submissions/outbox-rules";

/**
 * "Enviar agora" in the logout warning and "Tentar enviar agora" on the
 * pending screen (MOB-15).
 *
 * Both called a plain pass, which only sends what the backoff already allows.
 * A pending item that had failed on a weak signal — exactly how items end up
 * pending in the field — waits up to fifteen minutes for its next try, so the
 * button spun and sent nothing, and the warning came back unchanged.
 *
 * These run the real `outbox.ts` over an in-memory disk and a fake API, like
 * outbox-runner.test.ts.
 */

// ---------------------------------------------------------------- natives
const disk = new Map<string, string>();
let diskUnreadable = false;

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      if (diskUnreadable) throw new Error("storage unavailable");
      return disk.get(key) ?? null;
    },
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

const sent: string[] = [];
const request = vi.fn();

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
        config: { body: Record<string, unknown> },
      ) => {
        sent.push(String(config.body.client_submission_id));
        return request(endpoint, config);
      },
    },
  };
});

const STORAGE_KEY = "@trajetto:outbox:v1";
const TEN_MINUTES = 10 * 60_000;

let outbox: typeof import("@/features/submissions/outbox");
let sendNow: typeof import("@/features/submissions/use-send-pending-now");

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  outbox = await import("@/features/submissions/outbox");
  sendNow = await import("@/features/submissions/use-send-pending-now");
});

function queued(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind: "delivery-proof",
    businessId: "business-1",
    ownerUserId: "user-a",
    endpoint: "/delivery/proof/delivery-1",
    body: { client_submission_id: id },
    photos: [],
    uploadType: "deliveryPhotos",
    photoField: "proof",
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: 0,
    status: "pending",
    ...overrides,
  };
}

/** Failed twice on a weak signal: waiting on the backoff. */
const backingOff = (id: string, overrides: Record<string, unknown> = {}) =>
  queued(id, { attempts: 2, nextAttemptAt: Date.now() + TEN_MINUTES, ...overrides });

const onDisk = (): Array<Record<string, unknown>> =>
  JSON.parse(disk.get(STORAGE_KEY) ?? "[]");

const timeout = () =>
  new ApiError("Tempo esgotado.", 0, "Timeout", "TIMEOUT");

beforeEach(() => {
  disk.clear();
  diskUnreadable = false;
  sent.length = 0;
  request.mockReset();

  outbox.detachOutbox();
  setSubmissionOwner("user-a");
});

describe("an item waiting on its backoff", () => {
  it("is skipped by a plain pass — the old button", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([backingOff("proof-1")]));
    request.mockResolvedValue({});

    await outbox.processOutbox();

    expect(sent).toEqual([]);
    expect(onDisk()).toHaveLength(1);
  });

  it("is sent by Enviar agora, and nothing is left", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([backingOff("proof-1")]));
    request.mockResolvedValue({});

    await expect(outbox.sendPendingNow()).resolves.toEqual({ remaining: 0 });

    expect(sent).toEqual(["proof-1"]);
    expect(onDisk()).toEqual([]);
  });

  it("says what is still here when the network fails again", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([backingOff("proof-1")]));
    request.mockRejectedValue(timeout());

    await expect(outbox.sendPendingNow()).resolves.toEqual({ remaining: 1 });

    expect(sent).toEqual(["proof-1"]);

    // Back on the schedule, one attempt more: nothing lost.
    expect(onDisk()[0]).toMatchObject({ status: "pending", attempts: 3 });
  });
});

describe("what Enviar agora does not touch", () => {
  it("leaves parked, failed, unclaimed and someone else's items alone", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        queued("parked-1", { status: "parked", parkedAt: 1 }),
        queued("failed-1", { status: "failed" }),
        backingOff("unclaimed-1", { ownerUserId: undefined }),
        backingOff("foreign-1", { ownerUserId: "user-b" }),
        backingOff("mine-1"),
      ]),
    );
    request.mockResolvedValue({});

    await expect(outbox.sendPendingNow()).resolves.toEqual({ remaining: 0 });

    // Each of the others has its own decision on the pending screen.
    expect(sent).toEqual(["mine-1"]);
    expect(onDisk().map((item) => item.id)).toEqual([
      "parked-1",
      "failed-1",
      "unclaimed-1",
      "foreign-1",
    ]);

    // Their schedule is untouched.
    expect(onDisk()[2].nextAttemptAt).toBeGreaterThan(Date.now());
    expect(onDisk()[3].nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("sends nothing without a session", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([backingOff("proof-1")]));
    setSubmissionOwner(null);

    await expect(outbox.sendPendingNow()).resolves.toEqual({ remaining: 0 });
    expect(sent).toEqual([]);
  });
});

describe("a pass already running when the button is pressed", () => {
  it("does not swallow the items it did not pick", async () => {
    disk.set(
      STORAGE_KEY,
      JSON.stringify([queued("due-1"), backingOff("proof-1")]),
    );

    // Hold the first send so the pass is still running at the tap.
    let release: () => void = () => undefined;
    request.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    request.mockResolvedValue({});

    const running = outbox.processOutbox();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pressed = outbox.sendPendingNow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();

    await running;
    await expect(pressed).resolves.toEqual({ remaining: 0 });

    expect(sent).toEqual(["due-1", "proof-1"]);
  });
});

describe("the rule", () => {
  it("hurries only this driver's own pending items", () => {
    const item = { ownerUserId: "user-a", status: "pending" as const, nextAttemptAt: 0 };

    expect(isHurriableBy(item, "user-a")).toBe(true);
    expect(isHurriableBy({ ...item, status: "parked" }, "user-a")).toBe(false);
    expect(isHurriableBy({ ...item, status: "failed" }, "user-a")).toBe(false);
    expect(isHurriableBy({ ...item, ownerUserId: undefined }, "user-a")).toBe(false);
    expect(isHurriableBy(item, "user-b")).toBe(false);
    expect(isHurriableBy(item, null)).toBe(false);
  });
});

describe("the action every send-now button runs", () => {
  // What the logout warning and the pending screen call on a tap
  // (useSendPendingNow). The screen's button ran processOutbox — the pass
  // above that sends nothing while the item backs off.
  it("sends an item waiting on its backoff and reports nothing left", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([backingOff("proof-1")]));
    request.mockResolvedValue({});

    await expect(sendNow.sendNowOutcome()).resolves.toEqual({ incomplete: false });

    expect(sent).toEqual(["proof-1"]);
    expect(onDisk()).toEqual([]);
  });

  it("reports what the network refused again as incomplete", async () => {
    disk.set(STORAGE_KEY, JSON.stringify([backingOff("proof-1")]));
    request.mockRejectedValue(timeout());

    await expect(sendNow.sendNowOutcome()).resolves.toEqual({ incomplete: true });
    expect(onDisk()).toHaveLength(1);
  });

  it("reports a send that could not run as incomplete instead of throwing", async () => {
    // A tap must end in a message, never in an unhandled rejection and a
    // button that stops spinning with nothing said.
    diskUnreadable = true;

    await expect(sendNow.sendNowOutcome()).resolves.toEqual({ incomplete: true });
    expect(sent).toEqual([]);
  });

  it("is not incomplete for items it does not send (parked, failed)", async () => {
    // Those have their own decision on the pending screen; the "Nem tudo foi
    // enviado" line is about what a connection could still send.
    disk.set(
      STORAGE_KEY,
      JSON.stringify([
        queued("parked-1", { status: "parked", parkedAt: 1 }),
        queued("failed-1", { status: "failed" }),
        backingOff("mine-1"),
      ]),
    );
    request.mockResolvedValue({});

    await expect(sendNow.sendNowOutcome()).resolves.toEqual({ incomplete: false });
    expect(sent).toEqual(["mine-1"]);
  });
});

describe("the buttons that promise to send now", () => {
  // A tripwire, not behavioural evidence (TSX has no renderer here, as in
  // access-navigation-wiring.test.ts): the behaviour is the action above.
  // This pins that both buttons still run it — the pending screen's was the
  // one left calling a plain pass after the modal's was fixed.
  const read = (path: string) =>
    readFileSync(resolve(__dirname, "../..", path), "utf8").replace(/\r\n/g, "\n");

  const screens = [
    "app/(protected)/pending-submissions.tsx",
    "components/ui/logout-modal.tsx",
  ];

  it.each(screens)("%s runs the shared action, never a plain pass", (path) => {
    const source = read(path);

    expect(source).toContain("useSendPendingNow()");
    expect(source).not.toMatch(/\bprocessOutbox\b/);
    expect(source).not.toMatch(/\bsendPendingNow\b/);
  });

  it.each(screens)("%s says when not everything went", (path) => {
    expect(read(path)).toMatch(/incomplete: sendIncomplete/);
  });

  it("the shared hook sends through that action", () => {
    const hook = read("features/submissions/use-send-pending-now.ts");

    expect(hook).toMatch(/const run = sendNowOutcome\(\)/);
  });
});
