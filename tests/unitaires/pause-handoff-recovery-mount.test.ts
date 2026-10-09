import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A pause gesture left mid-handoff by a killed app (tapped and recorded on
 * the phone, never sent nor queued) is queued as soon as the session is up,
 * wherever the app lands (decision 6.1: pauses work offline).
 *
 * Before, the recovery ran only from the pause hook of the Entregas tab, or
 * at the next pause gesture. After a kill the app starts at its home, so a
 * driver who never opened that tab left the gesture on the phone for the
 * rest of the day, and the office's report missed the pause. The recovery
 * itself is tested in pause-actions.test.ts.
 */

const effects: Array<() => unknown> = [];

vi.mock("react", () => ({
  useEffect: (effect: () => unknown) => {
    effects.push(effect);
  },
}));

const session: { user: { id: string } | null } = { user: { id: "user-a" } };

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (select: (state: typeof session) => unknown) => select(session),
}));

const recoverPauseHandoffs = vi.fn(async (_userId: string) => undefined);

vi.mock("@/features/pauses/pause-actions", () => ({
  recoverPauseHandoffs: (userId: string) => recoverPauseHandoffs(userId),
}));

const read = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8").replace(/\r\n/g, "\n");

const runEffects = () => {
  effects.splice(0).forEach((effect) => effect());
};

beforeEach(() => {
  effects.length = 0;
  recoverPauseHandoffs.mockClear();
  session.user = { id: "user-a" };
});

describe("the pause handoff recovery", () => {
  it("queues this driver's leftover gestures once the session is up", async () => {
    const { useRecoverPauseHandoffs } = await import(
      "@/features/pauses/use-recover-pause-handoffs"
    );

    useRecoverPauseHandoffs();
    runEffects();

    expect(recoverPauseHandoffs).toHaveBeenCalledTimes(1);
    expect(recoverPauseHandoffs).toHaveBeenCalledWith("user-a");
  });

  it("touches nothing without a session: the gestures belong to whoever made them", async () => {
    session.user = null;

    const { useRecoverPauseHandoffs } = await import(
      "@/features/pauses/use-recover-pause-handoffs"
    );

    useRecoverPauseHandoffs();
    runEffects();

    expect(recoverPauseHandoffs).not.toHaveBeenCalled();
  });

  it("runs with the Entregas machinery, whatever screen the app lands on", () => {
    const layout = read("app/(protected)/_layout.tsx");
    const block = layout.slice(
      layout.indexOf("const DeliveriesRealtime"),
      layout.indexOf("const ProtectedLayout"),
    );

    expect(block).toContain("useRecoverPauseHandoffs();");
    expect(layout).toMatch(/\{surfaces\.deliveries \? <DeliveriesRealtime \/> : null\}/);
  });
});
