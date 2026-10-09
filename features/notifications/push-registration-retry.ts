/**
 * Runs the push registration until one attempt succeeds, one at a time.
 *
 * Registering once per mount lost the registration to any bad moment of the
 * network at login, and the device stayed bound to whoever used it before —
 * their pushes landing on this person's phone until the app restarted with
 * signal. The hook calls `attempt` on mount, when the app returns to the
 * foreground and when the network comes back; this decides whether anything
 * actually runs.
 *
 * An attempt that RESOLVES counts as done, even when it registered nothing
 * (no permission, emulator, no projectId): asking again on every foreground
 * would only re-prompt a driver who already said no. Only a failure — the
 * request did not go through — is worth another try.
 */
interface RegistrationRetry {
  attempt: () => Promise<void>;
  isDone: () => boolean;

  /** For unmount: nothing runs after this. */
  stop: () => void;
}

function createRegistrationRetry(
  register: () => Promise<void>,
  onError?: (error: unknown) => void,
): RegistrationRetry {
  let done = false;
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  const attempt = (): Promise<void> => {
    if (done || stopped) return Promise.resolve();
    if (inFlight) return inFlight;

    inFlight = register()
      .then(
        () => {
          done = true;
        },
        (error: unknown) => {
          onError?.(error);
        },
      )
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };

  return {
    attempt,
    isDone: () => done,
    stop: () => {
      stopped = true;
    },
  };
}

export { createRegistrationRetry };
export type { RegistrationRetry };
