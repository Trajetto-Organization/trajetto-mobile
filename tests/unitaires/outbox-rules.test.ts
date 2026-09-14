import { describe, expect, it } from "vitest";

import {
  canActOn,
  claim,
  classifyOwnership,
  isSendableBy,
  isVisibleTo,
  selectSendable,
  selectVisible,
} from "../../features/submissions/outbox-rules";

import type { OwnedSubmission } from "../../features/submissions/outbox-rules";

/**
 * The queue outlives the session, so these rules are the only thing standing
 * between a driver and someone else's delivery proof being sent under their
 * name. Every case the product has to survive is pinned here: a logout with
 * work still queued, the same driver coming back, a different driver coming
 * back, a session that expired on its own, and the retry path.
 */
const DRIVER_A = "user-a";
const DRIVER_B = "user-b";

const NOW = 1_700_000_000_000;

interface QueuedProps extends Partial<OwnedSubmission> {
  id?: string;
}

const queued = ({
  id = "item-1",
  ownerUserId = DRIVER_A,
  status = "pending",
  nextAttemptAt = NOW - 1,
}: QueuedProps = {}) => ({ id, ownerUserId, status, nextAttemptAt });

describe("logout with a pending queue", () => {
  it("keeps the item and still calls it the same driver's", () => {
    // Nothing about the rules changes when the session ends: the item is not
    // rewritten, not cleared, not disowned. What changes is who is asking.
    const item = queued();

    expect(classifyOwnership(item, null)).toBe("foreign");
    expect(item.ownerUserId).toBe(DRIVER_A);
  });

  it("sends nothing while there is no session to send under", () => {
    // A refresh token that expired overnight lands here. The queue must wait,
    // not drain into a request with no credentials and not delete itself.
    expect(isSendableBy(queued(), null, NOW)).toBe(false);
    expect(selectSendable([queued()], null, NOW)).toHaveLength(0);
  });
});

describe("the same driver logs back in", () => {
  it("sees the queue and may resume it", () => {
    const item = queued();

    expect(classifyOwnership(item, DRIVER_A)).toBe("own");
    expect(isVisibleTo(item, DRIVER_A)).toBe(true);
    expect(isSendableBy(item, DRIVER_A, NOW)).toBe(true);
  });

  it("still honours the backoff of an item that is not due yet", () => {
    const waiting = queued({ nextAttemptAt: NOW + 60_000 });

    expect(isVisibleTo(waiting, DRIVER_A)).toBe(true);
    expect(isSendableBy(waiting, DRIVER_A, NOW)).toBe(false);
  });
});

describe("a different driver logs in on the same phone", () => {
  const foreign = queued();

  it("never sends the previous driver's work", () => {
    // The harm this prevents is not privacy, it is attribution: the request
    // would be accepted, and the company would record driver B as having
    // delivered what driver A delivered.
    expect(classifyOwnership(foreign, DRIVER_B)).toBe("foreign");
    expect(isSendableBy(foreign, DRIVER_B, NOW)).toBe(false);
  });

  it("never shows it either", () => {
    expect(isVisibleTo(foreign, DRIVER_B)).toBe(false);
    expect(selectVisible([foreign], DRIVER_B)).toHaveLength(0);
  });

  it("refuses retry and discard on it", () => {
    expect(canActOn(foreign, DRIVER_B)).toBe(false);
  });

  it("does not hide or block that driver's own items", () => {
    const mine = queued({ id: "item-2", ownerUserId: DRIVER_B });
    const queue = [foreign, mine];

    expect(selectVisible(queue, DRIVER_B)).toEqual([mine]);
    expect(selectSendable(queue, DRIVER_B, NOW)).toEqual([mine]);
  });

  it("leaves the first driver's queue whole for their return", () => {
    const queue = [foreign, queued({ id: "item-2", ownerUserId: DRIVER_B })];

    expect(selectVisible(queue, DRIVER_A)).toEqual([foreign]);
    expect(selectSendable(queue, DRIVER_A, NOW)).toEqual([foreign]);
  });
});

describe("items queued before ownership was recorded", () => {
  const legacy: OwnedSubmission & { id: string } = {
    id: "old",
    status: "pending",
    nextAttemptAt: 0,
  };

  it("belong to nobody, whoever is asking", () => {
    expect(classifyOwnership(legacy, DRIVER_A)).toBe("unclaimed");
    expect(classifyOwnership(legacy, DRIVER_B)).toBe("unclaimed");
    expect(classifyOwnership(legacy, null)).toBe("unclaimed");
  });

  it("are shown rather than deleted", () => {
    // Deleting is the one irreversible option, and the item may be the only
    // record that a parcel was ever delivered.
    expect(isVisibleTo(legacy, DRIVER_A)).toBe(true);
  });

  it("are never sent on their own", () => {
    expect(isSendableBy(legacy, DRIVER_A, NOW)).toBe(false);
    expect(selectSendable([legacy], DRIVER_A, NOW)).toHaveLength(0);
  });

  it("become sendable only once a person claims them", () => {
    const claimed = claim(legacy, DRIVER_A);

    expect(claimed.ownerUserId).toBe(DRIVER_A);
    expect(isSendableBy(claimed, DRIVER_A, NOW)).toBe(true);
  });

  it("cannot be claimed with no session", () => {
    expect(canActOn(legacy, null)).toBe(false);
  });
});

describe("claiming", () => {
  it("never moves an item from one driver to another", () => {
    // The retry button runs this. Without the guard, driver B pressing retry
    // on anything of driver A's would quietly re-file it under B.
    const item = queued();

    expect(claim(item, DRIVER_B)).toBe(item);
    expect(claim(item, DRIVER_B).ownerUserId).toBe(DRIVER_A);
  });

  it("does not mutate the item it claims", () => {
    const legacy: OwnedSubmission = { status: "failed", nextAttemptAt: 0 };
    const claimed = claim(legacy, DRIVER_A);

    expect(legacy.ownerUserId).toBeUndefined();
    expect(claimed).not.toBe(legacy);
  });

  it("keeps the idempotency key, so claiming cannot duplicate a record", () => {
    // The item id IS the Idempotency-Key the API deduplicates on. If claiming
    // minted a new item instead of stamping this one, an attempt that had
    // already reached the server would come back as a second delivery proof.
    const legacy: OwnedSubmission & { id: string } = {
      id: "submission-1",
      status: "pending",
      nextAttemptAt: 0,
    };

    expect(claim(legacy, DRIVER_A).id).toBe("submission-1");
  });
});

describe("statuses other than pending", () => {
  it("never go out on a sweep, even for their own driver", () => {
    // `failed` waits for a person, `parked` waits for the module to come back.
    // Neither is the sweep's to decide, and idempotency does not help here:
    // the duplicate would be a second decision, not a second attempt.
    const failed = queued({ status: "failed" });
    const parked = queued({ status: "parked" });

    expect(isSendableBy(failed, DRIVER_A, NOW)).toBe(false);
    expect(isSendableBy(parked, DRIVER_A, NOW)).toBe(false);
  });

  it("stay visible and actionable for their own driver", () => {
    const failed = queued({ status: "failed" });

    expect(isVisibleTo(failed, DRIVER_A)).toBe(true);
    expect(canActOn(failed, DRIVER_A)).toBe(true);
  });
});

describe("a queue holding both drivers at once", () => {
  it("splits cleanly, with nothing counted by both and nothing dropped", () => {
    // The state after A queues work, logs out, B signs in and queues their
    // own, and both later come back. Each sweep must see exactly its own half.
    const queue = [
      queued({ id: "a-1", ownerUserId: DRIVER_A }),
      queued({ id: "b-1", ownerUserId: DRIVER_B }),
      queued({ id: "a-2", ownerUserId: DRIVER_A }),
    ];

    const forA = selectSendable(queue, DRIVER_A, NOW).map((item) => item.id);
    const forB = selectSendable(queue, DRIVER_B, NOW).map((item) => item.id);

    expect(forA).toEqual(["a-1", "a-2"]);
    expect(forB).toEqual(["b-1"]);
    expect(forA.concat(forB).sort()).toEqual(["a-1", "a-2", "b-1"]);
  });
});
