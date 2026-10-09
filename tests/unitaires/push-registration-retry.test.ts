import { describe, expect, it, vi } from "vitest";

import { createRegistrationRetry } from "@/features/notifications/push-registration-retry";

/**
 * Registering the device for push until it takes (MOB-05).
 *
 * The app registered once per mount and never again. A driver who logged in
 * on a bad network lost that one POST, and the phone stayed bound to whoever
 * had used it before — their pushes kept arriving on this driver's phone
 * until the app was restarted with signal. The registration is now retried
 * when the app comes back to the foreground or the network returns, until
 * one attempt succeeds.
 */
describe("the registration retry", () => {
  it("tries again after a failure, and stops after the first success", async () => {
    const register = vi
      .fn<[], Promise<void>>()
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValue(undefined);

    const retry = createRegistrationRetry(register);

    await retry.attempt();
    expect(retry.isDone()).toBe(false);

    await retry.attempt();
    expect(retry.isDone()).toBe(true);

    await retry.attempt();
    await retry.attempt();

    expect(register).toHaveBeenCalledTimes(2);
  });

  it("never runs two attempts at once", async () => {
    let finish: () => void = () => undefined;

    const register = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const retry = createRegistrationRetry(register);

    // Foreground and reconnection often fire together.
    const first = retry.attempt();
    const second = retry.attempt();

    finish();
    await Promise.all([first, second]);

    expect(register).toHaveBeenCalledTimes(1);
  });

  it("reports a failure and does not throw it", async () => {
    const onError = vi.fn();
    const retry = createRegistrationRetry(
      () => Promise.reject(new Error("sem rede")),
      onError,
    );

    await expect(retry.attempt()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("does nothing once stopped", async () => {
    const register = vi.fn(() => Promise.reject(new Error("rede")));
    const retry = createRegistrationRetry(register);

    retry.stop();
    await retry.attempt();

    expect(register).not.toHaveBeenCalled();
  });
});
