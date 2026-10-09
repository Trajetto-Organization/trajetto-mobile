import { describe, expect, it } from "vitest";

import {
  MAX_REUPLOADS,
  START_ROUTE_SEND_TTL_MS,
  isSendExpired,
  nextAfterFailure,
} from "@/features/submissions/outbox-rules";
import {
  bumpQueuedMileage,
  isCancellation,
} from "@/features/submissions/queue-decision";
import {
  hasRefusalRules,
  refusalVerdict,
  type RefusedItem,
} from "@/features/submissions/kind-refusals";

/**
 * Boundaries of the offline queue that the mutation run (Stryker, 06/10/2026)
 * found unpinned: the exact instant a departure expires, the reupload cap
 * applied only to reupload failures, an abort recognised by its name alone,
 * an equal odometer reading, and which failures a kind's refusal rules read.
 */
describe("outbox: retry and expiry boundaries", () => {
  it("does not fail a transient error just because the item already hit the reupload cap", () => {
    const next = nextAfterFailure(
      { attempts: 1, reuploads: MAX_REUPLOADS },
      "transient",
      0,
      { random: () => 0.5 },
    );

    expect(next?.status).toBe("pending");
  });

  it("still sends a departure exactly at its time-to-live, and expires it one ms later", () => {
    const createdAt = new Date(0).toISOString();
    const item = { kind: "delivery-start-route", createdAt };

    expect(isSendExpired(item, START_ROUTE_SEND_TTL_MS)).toBe(false);
    expect(isSendExpired(item, START_ROUTE_SEND_TTL_MS + 1)).toBe(true);
  });
});

describe("queue decision: abort and mileage", () => {
  it("reads an AbortError as the driver stopping, even without a signal", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });

    expect(isCancellation(abort)).toBe(true);
  });

  it("does not read another error, or an error with no name, as an abort", () => {
    expect(isCancellation(new TypeError("Network request failed"))).toBe(false);
    expect(isCancellation(Object.assign(new Error("x"), { name: "" }))).toBe(false);
  });

  it("leaves the cached vehicle untouched when the queued reading equals it", () => {
    const vehicle = { id: "v-1", current_mileage: 1200 };

    expect(bumpQueuedMileage(vehicle, 1200)).toBe(vehicle);
  });
});

describe("kind refusals: only an answer on the merits", () => {
  const pauseEnd: RefusedItem = {
    id: "p-1",
    kind: "delivery-pause-end",
    status: "pending",
    businessId: "b-1",
    ownerUserId: "u-1",
    endpoint: "/driver-pause/end",
    body: {},
    createdAt: new Date(0).toISOString(),
  };

  it("settles an already-ended pause when the API said so on the merits", () => {
    expect(
      refusalVerdict(pauseEnd, { source: "api", code: "PAUSE_ALREADY_ENDED" }, []),
    ).toEqual({ outcome: "settled", reason: "already-ended" });
  });

  it("ignores the same code when it did not come from the API", () => {
    expect(
      refusalVerdict(pauseEnd, { source: "upload", code: "PAUSE_ALREADY_ENDED" }, []),
    ).toBeNull();
  });

  it("ignores the code on a transient or an authentication failure", () => {
    expect(
      refusalVerdict(
        pauseEnd,
        { source: "api", isTransient: true, code: "PAUSE_ALREADY_ENDED" },
        [],
      ),
    ).toBeNull();
    expect(
      refusalVerdict(
        pauseEnd,
        { source: "api", isAuthenticationError: true, code: "PAUSE_ALREADY_ENDED" },
        [],
      ),
    ).toBeNull();
  });

  it("gives refusal rules only to pause and on-the-way kinds", () => {
    expect(hasRefusalRules("delivery-pause-end")).toBe(true);
    expect(hasRefusalRules("delivery-on-the-way")).toBe(true);
    expect(hasRefusalRules("fuel")).toBe(false);
  });
});
