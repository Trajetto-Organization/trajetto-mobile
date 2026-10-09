import { useCallback, useRef, useState } from "react";

import { useOutboxStore } from "@/store/outbox-store";
import { logger } from "@/utils/logger";

import { sendPendingNow } from "./outbox";

interface SendNowOutcome {
  /**
   * Some of this driver's pending items are still on the phone afterwards:
   * the network failed again, or the send could not run at all.
   */
  incomplete: boolean;
}

/**
 * The action behind every button that promises to send this driver's pending
 * submissions right away: "Enviar agora" in the logout warning and "Tentar
 * enviar agora" on the pending screen (MOB-15).
 *
 * Each button used to be wired on its own, and the screen's still ran a plain
 * pass — which skips every item waiting on its backoff, so it spun and sent
 * nothing in the one case it exists for. Never throws: a send that could not
 * run is reported like one the network refused, since in both cases the work
 * is still on the phone.
 */
async function sendNowOutcome(): Promise<SendNowOutcome> {
  try {
    const { remaining } = await sendPendingNow();

    return { incomplete: remaining > 0 };
  } catch (error) {
    logger.error("outbox: send now could not run", error);

    return { incomplete: true };
  }
}

interface SendPendingNow {
  send: () => Promise<SendNowOutcome>;

  /** Forgets the last outcome (the logout modal opening again). */
  reset: () => void;

  /** This tap, or a pass the queue started on its own, is running. */
  isSending: boolean;

  /** The last tap left something behind: say so (SEND_NOW_INCOMPLETE_MESSAGE). */
  incomplete: boolean;
}

function useSendPendingNow(): SendPendingNow {
  const isProcessing = useOutboxStore((state) => state.isProcessing);

  const [isHurrying, setIsHurrying] = useState<boolean>(false);
  const [incomplete, setIncomplete] = useState<boolean>(false);

  // A second tap before the re-render would only wait on the same pass.
  const inFlightRef = useRef<Promise<SendNowOutcome> | null>(null);

  const send = useCallback((): Promise<SendNowOutcome> => {
    if (inFlightRef.current) return inFlightRef.current;

    setIsHurrying(true);
    setIncomplete(false);

    const run = sendNowOutcome().then((outcome) => {
      inFlightRef.current = null;

      setIncomplete(outcome.incomplete);
      setIsHurrying(false);

      return outcome;
    });

    inFlightRef.current = run;
    return run;
  }, []);

  const reset = useCallback(() => setIncomplete(false), []);

  return {
    send,
    reset,
    isSending: isHurrying || isProcessing,
    incomplete,
  };
}

export { sendNowOutcome, useSendPendingNow };
export type { SendNowOutcome, SendPendingNow };
