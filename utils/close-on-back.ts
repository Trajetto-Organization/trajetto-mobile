// Pure on purpose (no react-native import): the unit tests run in Node.

/** The slice of React Native's BackHandler this needs. */
export interface BackPressSource {
  addEventListener(eventName: "hardwareBackPress", handler: () => boolean | null | undefined): {
    remove(): void;
  };
}

/**
 * While subscribed, the hardware back button closes the overlay and stops
 * there (returns true), instead of reaching the router or finishing the
 * Activity. Returns the unsubscribe.
 */
export function subscribeCloseOnBack(source: BackPressSource, onClose: () => void): () => void {
  const subscription = source.addEventListener("hardwareBackPress", () => {
    onClose();
    return true;
  });
  return () => subscription.remove();
}
