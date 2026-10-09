import { useEffect } from "react";
import { BackHandler } from "react-native";

import { subscribeCloseOnBack } from "../utils/close-on-back";

/**
 * For @gorhom/bottom-sheet modals, which ignore the back button: found on
 * the emulator, back with the settings drawer open finished the Activity
 * (the app left the screen), and on the proof screen it would leave the form
 * with the photo sheet still meant to be open. Listening only while visible
 * keeps the screen's own back behaviour untouched otherwise.
 */
export function useCloseOnBack(visible: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!visible) return undefined;
    return subscribeCloseOnBack(BackHandler, onClose);
  }, [visible, onClose]);
}
