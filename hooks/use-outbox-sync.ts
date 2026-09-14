import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuthStore } from "@/store/auth-store";
import { useConnectionStore } from "@/store/connection-store";

import { useOutboxStore, selectPendingCount } from "@/store/outbox-store";
import { loadOutbox, processOutbox } from "@/features/submissions/outbox";

/**
 * Sweeping the queue in the background is what makes it a wake-up interval and
 * not a polling loop: it only exists to honour the backoff between retries,
 * since every other trigger here is an event.
 */
const SWEEP_INTERVAL_MS = 30_000;

/**
 * Drives the submission queue from wherever the app happens to be.
 *
 * A driver who fills a checklist in a basement garage should not have to
 * remember to reopen the app on the surface. So the queue is woken by the
 * things that change the odds of a send succeeding: coming back online, coming
 * back to the foreground, and starting up.
 *
 * Only the device radio gates a pass. `isApiUnreachable` deliberately does
 * not: that flag clears when a request completes, and if the queue waited for
 * it, it would be waiting for someone else to make the request that proves the
 * API is back — on a quiet screen, nobody ever does, and the queue deadlocks.
 * The queue is its own probe; the per-item backoff already keeps it from
 * hammering a server that is genuinely down.
 */
function useOutboxSync(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const pendingCount = useOutboxStore(selectPendingCount);

  const isDeviceOffline = useConnectionStore((state) => state.isDeviceOffline);
  const isApiUnreachable = useConnectionStore(
    (state) => state.isApiUnreachable,
  );

  // Read from disk once the session exists. Until then the queue is not ours
  // to touch — its items belong to whoever was logged in when they were made.
  useEffect(() => {
    if (!isAuthenticated) return;
    void loadOutbox().catch(() => undefined);
  }, [isAuthenticated]);

  // Either recovery signal — the radio coming back, or a request proving the
  // API answers again — kicks a pass immediately. This also fires on mount,
  // which covers the boot case without a second effect.
  useEffect(() => {
    if (!isAuthenticated || isDeviceOffline || isApiUnreachable) return;
    void processOutbox();
  }, [isAuthenticated, isDeviceOffline, isApiUnreachable]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") return;
      void processOutbox();
    });

    return () => subscription.remove();
  }, [isAuthenticated]);

  // Only runs while something is actually waiting, so an idle app schedules
  // nothing at all. Note the gate: the device being offline pauses the sweep,
  // the API merely looking unreachable does not — probing it is this sweep's
  // job.
  useEffect(() => {
    if (!isAuthenticated || isDeviceOffline || pendingCount === 0) return;

    const interval = setInterval(() => void processOutbox(), SWEEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isAuthenticated, isDeviceOffline, pendingCount]);
}

export { useOutboxSync };
