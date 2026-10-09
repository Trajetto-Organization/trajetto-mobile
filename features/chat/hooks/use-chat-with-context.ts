import { useEffect, useMemo } from "react";

import Toast from "react-native-toast-message";

import type { ChatContext, ChatContextParams } from "../chat-context";
import { chipTicketClosed, defaultComposerTarget, type TicketLike } from "../ticket-rules";

import { useChatContextChip } from "./use-chat-context-chip";
import { useChatConversation } from "./use-chat-conversation";

/**
 * The chat tab's conversation and its context chip (decision 6.7), wired
 * together. Its own hook so the wiring the screen runs is the one the tests
 * mount: removing the chip outright on a refusal still compiles, and it
 * dropped a chip the driver had just opened on another delivery.
 */
function useChatWithContext(params: ChatContextParams) {
  // What the driver's messages are about until they remove it.
  const chip = useChatContextChip(params);

  const chat = useChatConversation({
    // The API no longer accepts the cited delivery or route from this driver:
    // every next message would be refused the same way. Only a chip that
    // still cites it goes; one opened since on another delivery stays.
    onContextRejected: chip.dropRefused,
  });

  const chipTicketId = chip.context?.ticket?.id ?? null;
  const closed = chipTicketClosed(chipTicketId, chat.tickets);
  const { dropRefused } = chip;

  // Decision 14.5: the central closed the subject the chip names. The chip
  // goes back to the default (the API files the next words by itself) and
  // the driver is told why, instead of a refusal on the next send.
  useEffect(() => {
    if (!closed || !chipTicketId) return;

    dropRefused({ ticketId: chipTicketId });

    Toast.show({
      type: "info",
      text1: "Atendimento encerrado",
      text2: "A central encerrou esse assunto. Suas próximas mensagens vão como um novo assunto.",
      position: "top",
    });
  }, [closed, chipTicketId, dropRefused]);

  // Decision 14.5 (design §8.2): with no chip, the composer still names a
  // subject — the open ticket the central last wrote in, else the newest
  // open one — so the words land where the driver sees them going.
  const target = useMemo(
    () =>
      defaultComposerTarget({
        hasChip: chip.context !== null,
        messages: chat.messages,
        myUserId: chat.myUserId ?? null,
        tickets: chat.tickets,
      }),
    [chip.context, chat.messages, chat.myUserId, chat.tickets],
  );

  const composerContext: ChatContext | null =
    chip.context ?? (target.kind === "ticket" ? contextOfTicket(target.ticket) : null);

  return {
    chip,
    chat,
    composerContext,
    contextIsAutomatic: chip.context === null && composerContext !== null,
  };
}

/** A subject as the chip carries it. */
function contextOfTicket(ticket: Pick<TicketLike, "id" | "number" | "subject">): ChatContext {
  return {
    delivery: null,
    route: null,
    ticket: { id: ticket.id, number: ticket.number, subject: ticket.subject },
  };
}

export { contextOfTicket };

export { useChatWithContext };
