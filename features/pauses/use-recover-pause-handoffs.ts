import { useEffect } from "react";

import { useAuthStore } from "@/store/auth-store";

import { recoverPauseHandoffs } from "./pause-actions";

/**
 * Queues the pause gestures a killed app left mid-handoff (tapped and
 * recorded on the phone, never sent nor queued) as soon as the session is up.
 *
 * Mounted with the Entregas machinery rather than on the Entregas tab: after
 * a kill the app starts from its home, and a driver who never opened the tab
 * would keep the gesture on the phone until the next pause. The recovery is
 * serialised and takes each leftover once, so the pause hook calling it too
 * is harmless.
 */
function useRecoverPauseHandoffs(): void {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  useEffect(() => {
    if (!userId) return;

    void recoverPauseHandoffs(userId);
  }, [userId]);
}

export { useRecoverPauseHandoffs };
