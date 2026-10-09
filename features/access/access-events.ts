/**
 * The API's word that a company's plan changed (`entitlementsChanged`, sent to
 * every login of the company when a module is switched on or off).
 *
 * The app did not listen (MOB-11): tabs, card actions and parked submissions
 * only changed on the next `/user/me`, i.e. the next return to the
 * foreground. The event carries no authority — it only says "ask again" — so
 * it is routed to the same re-read of `/user/me` that `permissions_changed`
 * uses, and everything downstream (screens, tabs, the offline queue) follows
 * from the answer.
 */
const ENTITLEMENTS_CHANGED_EVENT = "entitlementsChanged";

interface AccessEventSource {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

/** Re-reads access on every plan change. Returns the unbind. */
function bindAccessEvents(
  socket: AccessEventSource,
  rereadAccess: () => Promise<void> | void,
): () => void {
  const handleEntitlementsChanged = () => {
    void Promise.resolve(rereadAccess()).catch(() => undefined);
  };

  socket.on(ENTITLEMENTS_CHANGED_EVENT, handleEntitlementsChanged);

  return () => {
    socket.off(ENTITLEMENTS_CHANGED_EVENT, handleEntitlementsChanged);
  };
}

/**
 * One access re-read at a time, and never one that is already stale.
 *
 * Joining the read in flight was not enough: a plan change that arrives while
 * a `/user/me` is on its way may have happened after the server answered it,
 * and the old plan stayed until the next foreground. A call made during a
 * read asks for exactly one more read after it (several calls, still one),
 * and every caller settles when the last read does.
 *
 * `task` is expected to handle its own failures; one that throws anyway ends
 * the batch with that error rather than hiding it.
 */
function rereadWithTrailing(task: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let again = false;

  const drain = async (): Promise<void> => {
    try {
      do {
        again = false;
        await task();
      } while (again);
    } finally {
      inFlight = null;
      again = false;
    }
  };

  return () => {
    if (inFlight) {
      again = true;
      return inFlight;
    }

    // Started on the next microtask so `inFlight` is set before `drain` can
    // clear it, even if `task` throws synchronously.
    inFlight = Promise.resolve().then(drain);
    return inFlight;
  };
}

export { ENTITLEMENTS_CHANGED_EVENT, bindAccessEvents, rereadWithTrailing };
export type { AccessEventSource };
