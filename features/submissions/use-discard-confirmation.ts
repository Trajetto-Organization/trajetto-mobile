import { useCallback, useRef, useState } from "react";
import Toast from "react-native-toast-message";

interface UseDiscardConfirmationInput {
  /** Throws away the draft and its photos. */
  onDiscard: () => Promise<void>;
}

interface DiscardConfirmation {
  isVisible: boolean;
  isDiscarding: boolean;

  request: () => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

/**
 * The "discard draft?" dialog, with the guards that make it safe to tap.
 *
 * Discarding deletes photos from disk and cannot be undone, so the confirm
 * button must not run twice — a double tap on a slow phone would otherwise
 * start a second deletion over a half-deleted draft. Cancel is likewise ignored
 * while the deletion is in flight, since dismissing the dialog would leave the
 * driver looking at a form that is being emptied underneath them.
 */
function useDiscardConfirmation({
  onDiscard,
}: UseDiscardConfirmationInput): DiscardConfirmation {
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [isDiscarding, setIsDiscarding] = useState<boolean>(false);

  const inFlightRef = useRef<boolean>(false);

  const request = useCallback(() => setIsVisible(true), []);

  const cancel = useCallback(() => {
    if (!inFlightRef.current) setIsVisible(false);
  }, []);

  const confirm = useCallback(async () => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setIsDiscarding(true);

    try {
      await onDiscard();
      setIsVisible(false);
    } catch {
      Toast.show({
        type: "error",
        text1: "Não foi possível descartar o rascunho",
        text2: "Tente novamente.",
        position: "top",
      });
    } finally {
      inFlightRef.current = false;
      setIsDiscarding(false);
    }
  }, [onDiscard]);

  return { isVisible, isDiscarding, request, cancel, confirm };
}

export { useDiscardConfirmation };
export type { DiscardConfirmation, UseDiscardConfirmationInput };
