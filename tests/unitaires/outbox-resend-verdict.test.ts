import { describe, expect, it } from "vitest";

import {
  START_ROUTE_EXPIRED_MESSAGE,
  START_ROUTE_SEND_TTL_MS,
  resendVerdict,
} from "../../features/submissions/outbox-rules";

/**
 * What "Tentar de novo" can do for an item on the pending screen (MOB-08).
 *
 * A queued "Iniciar rota" older than half a day is never sent: the queue
 * fails it with a message telling the driver to tap "Iniciar rota" again.
 * The screen still offered "Tentar de novo" on it, and the retry went
 * straight back through the same expiry — failed again at once, the same red
 * card, and a driver pressing it in a loop. An expired departure is not
 * resendable; the only honest choices are to discard it and, if the truck is
 * still leaving, start the route again from the route screen.
 */
const NOW = 1_790_000_000_000;
const HOUR = 60 * 60 * 1000;

const at = (ms: number) => new Date(ms).toISOString();

describe("resendVerdict", () => {
  it("refuses an expired departure, and says to tap Iniciar rota again", () => {
    const verdict = resendVerdict(
      { kind: "delivery-start-route", createdAt: at(NOW - 13 * HOUR) },
      NOW,
    );

    expect(verdict.resendable).toBe(false);
    expect(verdict.resendable === false && verdict.reason).toBe(
      START_ROUTE_EXPIRED_MESSAGE,
    );
    expect(START_ROUTE_EXPIRED_MESSAGE).toContain("Iniciar rota");
  });

  it("lets a departure still within the day be sent again", () => {
    expect(
      resendVerdict(
        {
          kind: "delivery-start-route",
          createdAt: at(NOW - START_ROUTE_SEND_TTL_MS + 60_000),
        },
        NOW,
      ),
    ).toEqual({ resendable: true });
  });

  it("never refuses a fact for its age", () => {
    // A proof, an arrival, a fueling stay true however late they arrive.
    for (const kind of [
      "delivery-proof",
      "delivery-arrival",
      "delivery-occurrence",
      "fuel",
      "checklist",
    ]) {
      expect(
        resendVerdict({ kind, createdAt: at(NOW - 30 * 24 * HOUR) }, NOW),
        kind,
      ).toEqual({ resendable: true });
    }
  });

  it("lets a departure whose age it cannot read be sent", () => {
    // Guessing "expired" would drop a departure nobody decided to drop.
    expect(
      resendVerdict({ kind: "delivery-start-route", createdAt: "?" }, NOW),
    ).toEqual({ resendable: true });
  });
});
