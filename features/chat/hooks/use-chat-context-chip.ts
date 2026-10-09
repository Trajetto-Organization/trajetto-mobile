import { useCallback, useState } from "react";

import {
  chatContextFromParams,
  chatContextParamsKey,
  chipCitesRefused,
  type ChatContext,
  type ChatContextParams,
  type ChatContextReference,
} from "../chat-context";

/**
 * The chat tab's context chip (decision 6.7): what the driver's messages are
 * about — a delivery, a route, or both — until the driver removes it.
 *
 * The tab stays mounted after its first visit, so a second "Falar com a base"
 * (another delivery, or the same one after the chip was removed) arrives as
 * new params on the same screen. Read only as the initial state, the chip
 * kept the first delivery, or stayed empty. It is adjusted during render,
 * keyed on the tap (React's pattern for state that follows a prop), so it
 * never shows one frame late.
 */
function useChatContextChip(params: ChatContextParams): {
  context: ChatContext | null;

  /** The driver removed the chip. */
  clear: () => void;

  /**
   * The API refused a message for what it cited. The chip goes only when it
   * still cites that: one put up since (another delivery) is valid.
   */
  dropRefused: (refused: ChatContextReference) => void;

  /** The driver picked a subject in the sheet (design §8.2). */
  choose: (context: ChatContext) => void;
} {
  const [context, setContext] = useState<ChatContext | null>(() =>
    chatContextFromParams(params),
  );

  const key = chatContextParamsKey(params);
  const [appliedKey, setAppliedKey] = useState<string>(key);

  if (appliedKey !== key) {
    setAppliedKey(key);

    const requested = chatContextFromParams(params);

    if (requested) setContext(requested);
  }

  const clear = useCallback(() => setContext(null), []);

  const dropRefused = useCallback(
    (refused: ChatContextReference) =>
      setContext((current) => (chipCitesRefused(current, refused) ? null : current)),
    [],
  );

  const choose = useCallback((next: ChatContext) => setContext(next), []);

  return { context, clear, dropRefused, choose };
}

export { useChatContextChip };
