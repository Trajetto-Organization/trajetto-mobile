import { create } from "zustand";

interface ConnectionState {
  /** The device has no network at all, as reported by NetInfo. */
  isDeviceOffline: boolean;

  /** The device has network, but the API did not answer. */
  isApiUnreachable: boolean;

  setDeviceOffline: (isDeviceOffline: boolean) => void;
  setApiUnreachable: (isApiUnreachable: boolean) => void;
}

/**
 * Whether the app can currently talk to the server.
 *
 * Two separate flags because they are two different messages. A driver in a
 * basement garage knows perfectly well why nothing is loading and only needs
 * reassurance that the checklist is not lost; a driver on full signal whose
 * requests are failing is looking at something that seems broken, and deserves
 * to be told it is the system and not them.
 *
 * Neither of these ends the session. That distinction already lives in
 * `apiClient` — an authoritative "no" from the API logs the user out, silence
 * from the API does not — and this store is only about saying so on screen.
 */
const useConnectionStore = create<ConnectionState>((set) => ({
  isDeviceOffline: false,
  isApiUnreachable: false,

  setDeviceOffline: (isDeviceOffline) => set({ isDeviceOffline }),
  setApiUnreachable: (isApiUnreachable) => set({ isApiUnreachable }),
}));

/**
 * Called from `apiClient` on every completed request.
 *
 * Set from outside React because that is where the knowledge is: the client is
 * the only thing that knows whether a request reached the server, and it is not
 * a component.
 */
function reportApiReachable(isReachable: boolean): void {
  const { isApiUnreachable, setApiUnreachable } = useConnectionStore.getState();
  const shouldBeUnreachable = !isReachable;

  // Guarded because this runs on every single request, and an unconditional
  // `set` would notify subscribers hundreds of times for an unchanged value.
  if (isApiUnreachable !== shouldBeUnreachable) {
    setApiUnreachable(shouldBeUnreachable);
  }
}

/** True when there is no point attempting a request right now. */
function isCurrentlyOffline(): boolean {
  const { isDeviceOffline, isApiUnreachable } = useConnectionStore.getState();
  return isDeviceOffline || isApiUnreachable;
}

export { useConnectionStore, reportApiReachable, isCurrentlyOffline };
