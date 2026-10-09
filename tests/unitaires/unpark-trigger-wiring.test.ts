import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Parked submissions go back in line on ONE trigger (MOB-03).
 *
 * The driver's list used to unpark every parked item whenever
 * `my-deliveries` succeeded — a DELIVERIES answer deciding for a FLEET item,
 * which re-sent a refused refuelling in a loop. Unparking is now driven by a
 * server observation of the item's own module (outbox-parked.test.ts proves
 * the behaviour); the list's trigger was left behind as a no-op. This keeps
 * it from coming back.
 */
const read = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("what unparks the queue", () => {
  it("is not the driver's list succeeding", () => {
    expect(read("features/deliveries/hooks/use-my-deliveries.ts")).not.toMatch(
      /unparkOutboxItems/,
    );
  });

  it("is a new observation of the modules", () => {
    expect(read("features/submissions/outbox.ts")).toMatch(
      /onModulesObserved\(unparkOutboxItems\)/,
    );
  });
});
