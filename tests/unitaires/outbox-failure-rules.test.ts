import { describe, expect, it } from "vitest";

import {
  MAX_REUPLOADS,
  RETRY_DELAYS_MS,
  classifyFailure,
  forgetUploads,
  nextAfterFailure,
  retryDelay,
  type FailureDescription,
} from "@/features/submissions/outbox-rules";

describe("a photo the storage no longer has", () => {
  /**
   * The API used to delete an item's uploaded photos when the database was
   * merely busy, and the retry — with the same keys — came back 400
   * UPLOADED_FILE_NOT_FOUND. As a plain 4xx that marked the item failed: the
   * driver's finished checklist or fueling, lost to a pool timeout, with the
   * photos still sitting on the phone.
   */
  const refused = {
    source: "api" as const,
    isTransient: false,
    code: "UPLOADED_FILE_NOT_FOUND",
  };

  it("is not the API refusing the work", () => {
    expect(classifyFailure(refused)).toBe("reupload");
  });

  it("keeps the item in line, paced like any retry", () => {
    // Jitter pinned at ×1: see outbox-backoff.test.ts for the spread itself.
    const next = nextAfterFailure({ attempts: 1 }, "reupload", 1_000, {
      random: () => 0.5,
    });

    expect(next?.status).toBe("pending");
    expect(next?.attempts).toBe(2);
    expect(next?.nextAttemptAt).toBe(1_000 + retryDelay(2));
  });

  it("stops sending the photos again once it is clearly not the storage", () => {
    // One lost set of objects is the old API cleaning up; the same answer
    // after the photos went up afresh, again and again, is a server bug. Left
    // pending, the item would push every photo over mobile data every quarter
    // of an hour for good. After the limit it is failed, where the driver
    // sees it, instead.
    const stillTrying = nextAfterFailure(
      { attempts: 3, reuploads: MAX_REUPLOADS - 1 },
      "reupload",
      1_000,
      { random: () => 0.5 },
    );

    expect(stillTrying?.status).toBe("pending");

    const givenUp = nextAfterFailure(
      { attempts: 4, reuploads: MAX_REUPLOADS },
      "reupload",
      1_000,
      { random: () => 0.5 },
    );

    expect(givenUp?.status).toBe("failed");
  });

  it("forgets what was uploaded, so every photo goes up again", () => {
    const photos = [
      { uri: "file://a.jpg", uploadedKey: "checklistPhotos/b/a.jpg" },
      { uri: "file://b.jpg" },
    ];

    expect(forgetUploads(photos)).toEqual([
      { uri: "file://a.jpg" },
      { uri: "file://b.jpg" },
    ]);
  });
});

/**
 * What happens to a driver's work when a send fails.
 *
 * This is the decision the whole offline queue exists to make, and until now
 * it had no test at all: it lived next to the sender, in a module that loads
 * AsyncStorage, expo-file-system and the HTTP client, so a unit suite could
 * not reach it.
 *
 * Getting it wrong is expensive in both directions. Treat a timeout as final
 * and a proof of delivery is thrown away with the truck already gone. Treat a
 * refusal as temporary and the phone retries the same rejected mileage every
 * fifteen minutes for the rest of the shift, burning battery and data on an
 * answer that will never change.
 */
const api = (extra: Partial<FailureDescription>): FailureDescription => ({
  source: "api",
  ...extra,
});

describe("no answer from the API", () => {
  it("is worth repeating", () => {
    expect(classifyFailure(api({ isTransient: true }))).toBe("transient");
  });

  it("covers a failed upload too", () => {
    // An expired signature is re-signed on the next attempt, and everything
    // else about a failed PUT is the connection.
    expect(classifyFailure({ source: "upload" })).toBe("transient");
  });

  it("covers something nobody recognised", () => {
    // Guessing "permanent" for an error our own code did not expect would
    // throw away a driver's work over a bug on our side.
    expect(classifyFailure({ source: "unknown" })).toBe("transient");
  });
});

describe("the API saying no", () => {
  it("is not worth repeating", () => {
    // Mileage below the vehicle's, an inactive branch: the same request gets
    // the same answer forever.
    expect(classifyFailure(api({ isTransient: false }))).toBe("permanent");
  });

  it("parks when the module itself is off, rather than failing the item", () => {
    // Nothing is wrong with this submission. Marking it failed would ask the
    // driver to look at something only the office can fix.
    expect(
      classifyFailure(api({ code: "MODULE_NOT_ENABLED" })),
    ).toBe("module-disabled");
  });

  it("puts authentication above everything else", () => {
    /**
     * Both flags true at once, which is the only input the ordering shows up
     * in — and the reason this case is written the awkward way.
     *
     * `isTransient` is any 5xx and `isAuthenticationError` is a 401 OR one of
     * the terminal auth codes, so a terminal code arriving with a 5xx sets
     * both. That shape exists in the product already: the API answers 503
     * when the session store cannot be read. Today it uses a code
     * (`AUTH_SESSION_UNAVAILABLE`) deliberately kept OUT of the terminal list,
     * so the two never coincide — but one line added to that list would make
     * them, and then the order decides whether a dead session waits for a
     * login or burns the whole backoff pretending the server is coming back.
     */
    expect(
      classifyFailure(
        api({
          isAuthenticationError: true,
          isTransient: true,
          code: "AUTH_SESSION_INVALIDATED",
        }),
      ),
    ).toBe("auth");
  });

  it("still parks a disabled module rather than calling it permanent", () => {
    // The module check sits after the transient one and before the fallback;
    // moving it past the fallback would make it unreachable.
    expect(
      classifyFailure(api({ isTransient: false, code: "MODULE_NOT_ENABLED" })),
    ).toBe("module-disabled");
  });

  it("fails a departure refused because another route is running, with no retry loop", () => {
    // 409 ROUTE_DRIVER_BUSY (FLEET-ASSIGN-3): the driver has to finish the
    // running route first. Not a contract problem an update fixes, and not
    // transient: resending before that only earns the same refusal.
    const busy = api({ isTransient: false, code: "ROUTE_DRIVER_BUSY" });

    expect(classifyFailure(busy)).toBe("permanent");
    expect(nextAfterFailure({ attempts: 0 }, "permanent", 1_000)?.status).toBe(
      "failed",
    );
  });
});

describe("what the queue does next", () => {
  const item = { attempts: 2 };

  it("leaves an expired session completely alone", () => {
    // Not even the attempt count moves: the failure says nothing about
    // whether this item would be accepted, so spending a retry on it would
    // push a valid submission towards being given up on.
    expect(nextAfterFailure(item, "auth", 1_000)).toBeNull();
  });

  it("parks without spending an attempt", () => {
    const next = nextAfterFailure(item, "module-disabled", 1_000);

    expect(next).toEqual({
      attempts: 2,
      nextAttemptAt: 1_000,
      status: "parked",
    });
  });

  it("counts the attempt and schedules the next one", () => {
    const next = nextAfterFailure(item, "transient", 1_000, {
      random: () => 0.5,
    });

    expect(next?.attempts).toBe(3);
    expect(next?.status).toBe("pending");
    expect(next?.nextAttemptAt).toBe(1_000 + RETRY_DELAYS_MS[3]);
  });

  it("marks a refusal as failed, for a person to look at", () => {
    const next = nextAfterFailure(item, "permanent", 1_000);

    expect(next?.status).toBe("failed");

    // Still counted, so the item carries how many times it was tried when
    // somebody opens it.
    expect(next?.attempts).toBe(3);
  });
});

describe("the backoff", () => {
  it("retries the first failure immediately", () => {
    // The first attempt often fails because the radio had not come back yet.
    // Waiting fifteen seconds for that would be a delay nobody needs.
    expect(retryDelay(0)).toBe(0);
  });

  it("grows", () => {
    const delays = [1, 2, 3, 4].map(retryDelay);

    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
  });

  it("stops growing instead of doubling forever", () => {
    // An outage lasting a whole shift must not leave the queue waiting on a
    // timer that grew while nobody was watching. Regaining signal fires a
    // pass immediately, so the cap costs nothing.
    const cap = RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

    expect(retryDelay(RETRY_DELAYS_MS.length)).toBe(cap);
    expect(retryDelay(9_999)).toBe(cap);
  });

  it("never waits more than fifteen minutes", () => {
    // A driver finishing a route wants the queue emptied before they hand the
    // phone in, not on a timer measured in hours.
    expect(Math.max(...RETRY_DELAYS_MS)).toBeLessThanOrEqual(15 * 60_000);
  });
});
