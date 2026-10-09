/**
 * The queue's word to the pause screen, without the queue importing UI.
 *
 * The outbox settles a pause gesture refused outside a journey (decision
 * 14.4; 409 PAUSE_REQUIRES_ROUTE) silently; the deliveries screen, which
 * owns the toasts, listens here and tells the driver why the pause is gone.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribes; returns the unsubscribe. */
function onPauseRequiresRoute(listener: Listener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function notifyPauseRequiresRoute(): void {
  for (const listener of listeners) listener();
}

export { notifyPauseRequiresRoute, onPauseRequiresRoute };
