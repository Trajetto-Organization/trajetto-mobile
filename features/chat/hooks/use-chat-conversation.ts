import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";

import Toast from "react-native-toast-message";
import type { Socket } from "socket.io-client";

import { useAuthStore } from "@/store/auth-store";
import { queryClient } from "@/providers/query-provider";

import { apiClient, ApiError } from "@/utils/api";
import { getSocket, initializeSocket } from "@/utils/socket";

import { uploadToStorage } from "@/features/media/upload-to-storage";

import {
  chatHintPulseMs,
  chatHintTtlMs,
  chatPresenceHint,
  confirmOptimistic,
  latestIso,
  markSendFailed,
  markSendPending,
  mergeIncomingMessage,
  newestDeliverableAt,
  presencePulseIsDue,
} from "../chat-rules";

import { markChatDelivered } from "../mark-delivered";
import { seedChatAudioCache } from "../audio-cache";

import type {
  ChatDeliveredEvent,
  ChatMessage,
  ChatMessagesResponse,
  ClientChatMessage,
} from "../types";

interface SendTextInput {
  kind: "TEXT";
  body: string;
  deliveryId?: string;
}

interface SendImageInput {
  kind: "IMAGE";
  body?: string;
  uri: string;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string | null;
  deliveryId?: string;
}

interface SendAudioInput {
  kind: "AUDIO";
  uri: string;
  durationMs: number;
  fileSize?: number;

  // A voice note is about a delivery as often as a typed one is — more often,
  // since speaking is what a driver does with their hands full.
  deliveryId?: string;
}

type SendInput = SendTextInput | SendImageInput | SendAudioInput;

/**
 * The driver's single conversation with the operation, live end to end:
 * history by cursor, optimistic sends with a safe retry (the submission id
 * makes a duplicate impossible), read cursors both ways and the staff's
 * "digitando..." / "gravando um áudio...". Sending needs a connection — the outbox stays the
 * delivery loop's tool; a chat is a conversation, not an appointment.
 */
function useChatConversation() {
  const user = useAuthStore((state) => state.user);

  const myUserId = user?.id ?? "";
  const businessId = user?.businessId ?? "";

  const [messages, setMessages] = useState<ClientChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);

  const [nextCursor, setNextCursor] = useState<{
    created_at: string;
    id: string;
  } | null>(null);

  const [counterpartReadAt, setCounterpartReadAt] = useState<string | null>(
    null,
  );

  // How far the SAC has confirmed RECEIVING what the driver sent — the grey
  // double check. A different cursor from the read one above, and the two
  // move independently.
  const [counterpartDeliveredAt, setCounterpartDeliveredAt] = useState<
    string | null
  >(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);

  const [loadError, setLoadError] = useState<string>("");
  const [moduleDisabled, setModuleDisabled] = useState<boolean>(false);

  /**
   * The two live hints from the other side, kept apart exactly as they arrive
   * on the wire. Both can be true in the same instant — a hand on the SAC's
   * keyboard and a voice note recording beside it — so folding them into one
   * flag would let whichever landed last erase the other. `staffHint` below
   * is where the screen's single line picks between them.
   */
  const [staffTyping, setStaffTyping] = useState<boolean>(false);
  const [staffRecording, setStaffRecording] = useState<boolean>(false);

  const threadIdRef = useRef<string | null>(null);
  const focusedRef = useRef<boolean>(false);

  // The newest instant already confirmed as delivered. Reloads that bring
  // nothing new must not re-confirm the same cursor on every render.
  const deliveredUpToRef = useRef<string | null>(null);

  const staffTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const staffRecordingTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  /** When the driver's own "digitando" last went out, or `null` for never. */
  const lastTypingEmitRef = useRef<number | null>(null);

  /**
   * Advances the staff delivery cursor, never rewinds it.
   *
   * Receipts arrive out of order as a matter of course: several SAC panels
   * confirm independently, the socket makes no ordering promise, and a reload
   * can answer with a snapshot older than an event already applied. Taking
   * the later of the two instants is what keeps the check from walking
   * backwards in front of the driver.
   */
  const advanceDeliveredCursor = useCallback(
    (incoming: string | null | undefined) => {
      if (!incoming) return;

      setCounterpartDeliveredAt((current) => latestIso(current, incoming));
    },
    [],
  );

  const adoptThreadId = useCallback((incoming: string | null) => {
    if (!incoming || threadIdRef.current === incoming) return;

    threadIdRef.current = incoming;
    setThreadId(incoming);
  }, []);

  const markRead = useCallback(async () => {
    if (!threadIdRef.current) return;

    try {
      await apiClient.post("/chat/mark-read", {
        threadId: threadIdRef.current,
      });

      // The hub badge derives from the cursor just advanced.
      queryClient.invalidateQueries({ queryKey: ["chat-unread"] });
    } catch {
      // Read receipts are decoration — never worth an error on screen.
    }
  }, []);

  /**
   * The "app was closed" case: everything that arrived while the app was gone
   * is only acknowledged now, when the history comes back from the server.
   *
   * The timestamp is the newest `created_at` the server actually issued —
   * never `Date.now()`, never an optimistic copy's local clock, never a
   * message the driver sent themselves. Socket arrivals are not handled here:
   * `useChatRealtime` runs across the whole protected area, this screen
   * included, and already confirms those.
   */
  const confirmDelivery = useCallback(
    (thread: string | null, list: ClientChatMessage[]) => {
      if (!thread) return;

      const deliveredAt = newestDeliverableAt(list, myUserId);

      if (!deliveredAt) return;

      // Only a set that really moved forward is worth a call.
      if (
        deliveredUpToRef.current &&
        new Date(deliveredAt) <= new Date(deliveredUpToRef.current)
      ) {
        return;
      }

      deliveredUpToRef.current = deliveredAt;
      void markChatDelivered(thread, deliveredAt);
    },
    [myUserId],
  );

  // =============================================================== load
  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    setModuleDisabled(false);

    try {
      const response = await apiClient.get<ChatMessagesResponse>(
        "/chat/list-messages?limit=40",
      );

      // The API answers newest-first; the screen renders oldest-first.
      setMessages([...response.data].reverse());
      setNextCursor(response.nextCursor);

      setCounterpartReadAt(response.counterpartLastReadAt);
      advanceDeliveredCursor(response.counterpartDeliveredAt);

      adoptThreadId(response.threadId);

      if (response.threadId) {
        void markRead();
        confirmDelivery(response.threadId, response.data);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "MODULE_NOT_ENABLED") {
        setModuleDisabled(true);
      } else {
        setLoadError(
          error instanceof ApiError
            ? error.message
            : "Não foi possível carregar a conversa. Verifique sua conexão.",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [adoptThreadId, advanceDeliveredCursor, confirmDelivery, markRead]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Re-signs ONE attachment and patches it into the conversation.
   *
   * This exists so the photo viewer's retry never has to call `load`. A reload
   * asks for the forty newest messages and REPLACES the list with them: the
   * history the driver paged in with "Mensagens anteriores" is discarded, and
   * an old photo — precisely the one whose signature is most likely to have
   * expired — falls out of the loaded window, un-anchors the viewer and closes
   * it on top of the person looking at it. The cure destroyed the patient.
   *
   * Two more things it deliberately does NOT do. It never touches
   * `loadError`, so a photo that could not be re-signed stays the photo's
   * problem instead of replacing a perfectly readable conversation with a
   * full-screen error. And it never touches `isLoading`, so nothing blinks.
   *
   * The answer is `false` for a message with no file and for a request that
   * failed; the viewer says so on the photo itself.
   */
  const renewAttachmentUrl = useCallback(
    async (messageId: string): Promise<boolean> => {
      try {
        const response = await apiClient.get<{
          attachment_url: string | null;
        }>(
          `/chat/attachment-url?messageId=${encodeURIComponent(messageId)}`,
        );

        const attachmentUrl = response.attachment_url;

        if (!attachmentUrl) return false;

        // The bubble in the thread carries the same expired url, so the patch
        // is worth making even though only the viewer asked for it.
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? { ...message, attachment_url: attachmentUrl }
              : message,
          ),
        );

        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const loadOlder = useCallback(async () => {
    if (!nextCursor || !threadIdRef.current || isLoadingOlder) return;

    setIsLoadingOlder(true);

    try {
      const query = new URLSearchParams({
        threadId: threadIdRef.current,
        limit: "40",
        beforeAt: nextCursor.created_at,
        beforeId: nextCursor.id,
      });

      const response = await apiClient.get<ChatMessagesResponse>(
        `/chat/list-messages?${query.toString()}`,
      );

      setMessages((current) => [...[...response.data].reverse(), ...current]);
      setNextCursor(response.nextCursor);

      advanceDeliveredCursor(response.counterpartDeliveredAt);
    } catch {
      Toast.show({
        type: "error",
        text1: "Não foi possível carregar mensagens anteriores",
        position: "top",
      });
    } finally {
      setIsLoadingOlder(false);
    }
  }, [nextCursor, isLoadingOlder, advanceDeliveredCursor]);

  // ============================================================ realtime
  useEffect(() => {
    let disposed = false;
    let boundSocket: Socket | null = null;

    const handleChatMessage = (incoming: ChatMessage) => {
      if (disposed || !incoming?.id) return;

      // The driver's user room only ever carries their own thread.
      adoptThreadId(incoming.threadId);

      setMessages((current) => mergeIncomingMessage(current, incoming));

      const fromOperation = incoming.senderId !== myUserId;

      if (
        fromOperation &&
        focusedRef.current &&
        AppState.currentState === "active"
      ) {
        void markRead();
      }
    };

    const handleChatRead = (event?: { userId?: string; last_read_at?: string }) => {
      if (disposed || !event?.last_read_at) return;

      // Only the OTHER side's cursor turns this screen's checks double.
      if (event.userId === myUserId) return;

      setCounterpartReadAt((current) =>
        !current || new Date(event.last_read_at!) > new Date(current)
          ? event.last_read_at!
          : current,
      );
    };

    const handleChatDelivered = (event?: ChatDeliveredEvent) => {
      if (disposed || !event?.delivered_at) return;

      // The driver's room only carries the staff side, but the side is on the
      // wire so it can be checked rather than trusted: the driver's own
      // receipt echoing back must never grey out their own checks.
      if (event.side !== "STAFF") return;

      advanceDeliveredCursor(event.delivered_at);
    };

    const handleChatTyping = () => {
      if (disposed) return;

      setStaffTyping(true);

      if (staffTypingTimer.current) clearTimeout(staffTypingTimer.current);

      staffTypingTimer.current = setTimeout(
        () => setStaffTyping(false),
        chatHintTtlMs("typing"),
      );
    };

    /**
     * "Gravando um áudio", on the very same path as "digitando" and now with
     * the same shape: a pulse that arrives every couple of seconds for as long
     * as the other side's microphone is really capturing.
     *
     * Every arrival lights the hint and RESTARTS the window, and the window is
     * short. Whatever becomes of whoever was recording — a socket that died,
     * an app that was killed, a phone that lost signal, a microphone the
     * system took away in the background — the pulses stop and the bubble
     * comes down `RECORDING_HINT_TTL_MS` later, with nobody having to say so.
     * That silence is the correction; everything below is about being quick
     * rather than about being right.
     *
     * `recording: false` is honoured for the instant response at a clean end
     * — sent, discarded, held. Nothing depends on it: with two people
     * recording at once a `false` from one of them puts the bubble out early,
     * and the other's next pulse brings it back within a pulse interval.
     */
    const handleChatRecording = (event?: { recording?: boolean }) => {
      if (disposed) return;

      if (staffRecordingTimer.current) {
        clearTimeout(staffRecordingTimer.current);
        staffRecordingTimer.current = null;
      }

      // The server always states the field; a pulse that somehow arrives
      // without it is still someone telling us their microphone is running.
      if (event?.recording === false) {
        setStaffRecording(false);
        return;
      }

      setStaffRecording(true);

      staffRecordingTimer.current = setTimeout(
        () => setStaffRecording(false),
        chatHintTtlMs("recording"),
      );
    };

    /**
     * A dropped connection takes both hints down with it.
     *
     * Courtesy, not correction: a socket that dies stops delivering pulses, so
     * both hints would go out on their own within their window anyway. This
     * only spares the driver the few seconds of a bubble that already has
     * nobody behind it.
     */
    const clearHints = () => {
      if (disposed) return;

      if (staffTypingTimer.current) clearTimeout(staffTypingTimer.current);

      if (staffRecordingTimer.current) {
        clearTimeout(staffRecordingTimer.current);
      }

      staffTypingTimer.current = null;
      staffRecordingTimer.current = null;

      setStaffTyping(false);
      setStaffRecording(false);
    };

    void initializeSocket()
      .then((socket) => {
        if (disposed) return;

        boundSocket = socket;

        socket.on("chatMessage", handleChatMessage);
        socket.on("chatRead", handleChatRead);
        socket.on("chatDelivered", handleChatDelivered);
        socket.on("chatTyping", handleChatTyping);
        socket.on("chatRecording", handleChatRecording);
        socket.on("disconnect", clearHints);
      })
      .catch(() => {
        // Without realtime the screen still works over HTTP.
      });

    return () => {
      disposed = true;

      boundSocket?.off("chatMessage", handleChatMessage);
      boundSocket?.off("chatRead", handleChatRead);
      boundSocket?.off("chatDelivered", handleChatDelivered);
      boundSocket?.off("chatTyping", handleChatTyping);
      boundSocket?.off("chatRecording", handleChatRecording);
      boundSocket?.off("disconnect", clearHints);

      if (staffTypingTimer.current) clearTimeout(staffTypingTimer.current);
      if (staffRecordingTimer.current) {
        clearTimeout(staffRecordingTimer.current);
      }
    };
  }, [adoptThreadId, advanceDeliveredCursor, markRead, myUserId]);

  // Focus bookkeeping: arriving on the screen reads the backlog; messages
  // landing while the screen is behind another one do not.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;

      if (threadIdRef.current) void markRead();

      return () => {
        focusedRef.current = false;
      };
    }, [markRead]),
  );

  // ====================================================== presence hints
  const emitTyping = useCallback(() => {
    const now = Date.now();

    if (
      !presencePulseIsDue({
        nowMs: now,
        lastPulseAtMs: lastTypingEmitRef.current,
        everyMs: chatHintPulseMs("typing"),
      })
    ) {
      return;
    }

    lastTypingEmitRef.current = now;
    getSocket()?.emit("chatTyping");
  }, []);

  /**
   * One pulse of "gravando um áudio", or the courtesy `false` that closes a
   * clean end.
   *
   * Deliberately not throttled here. The composer pulses off the recorder's
   * own clock — the only thing in the app that knows the microphone captured
   * something just now — and the relay is stateless and takes repetition by
   * design. A second, blinder clock in front of that one could only ever
   * swallow a pulse the first one was right to send.
   */
  const emitRecording = useCallback((recording: boolean) => {
    getSocket()?.emit("chatRecording", { recording });
  }, []);

  // ============================================================= sending
  const performSend = useCallback(
    async (outgoing: ClientChatMessage) => {
      try {
        let attachmentKey: string | undefined;

        if (outgoing.kind !== "TEXT") {
          if (!outgoing.localUri) throw new Error("missing-file");

          const [uploaded] = await uploadToStorage({
            entries: [
              {
                file: {
                  uri: outgoing.localUri,
                  fileName:
                    outgoing.kind === "AUDIO" ? "voice-note.m4a" : "chat.jpg",
                  fileSize: outgoing.localFileSize,
                  mimeType:
                    outgoing.localMimeType ??
                    (outgoing.kind === "AUDIO" ? "audio/m4a" : "image/jpeg"),
                },
              },
            ],
            uploadType: "chatAttachments",
            businessId,
          });

          attachmentKey = uploaded.key;
        }

        const response = await apiClient.post<{ data: ChatMessage[] }>(
          "/chat/send-message",
          {
            driverIds: [user?.driverId],
            kind: outgoing.kind,
            ...(outgoing.body && { body: outgoing.body }),
            ...(attachmentKey && { attachmentKey }),
            ...(outgoing.duration_ms && { durationMs: outgoing.duration_ms }),
            ...(outgoing.deliveryId && { deliveryId: outgoing.deliveryId }),
            clientSubmissionId: outgoing.client_submission_id,
          },
        );

        const confirmed = response.data[0];

        // The recording is already on this phone; file it under the id the
        // server just issued, or the driver's own note would come back asking
        // to be downloaded the moment the optimistic row is replaced.
        if (outgoing.kind === "AUDIO" && confirmed?.id) {
          seedChatAudioCache(confirmed.id, outgoing.attachment_url ?? "");
        }

        adoptThreadId(confirmed.threadId);

        setMessages((current) =>
          confirmOptimistic(
            current,
            outgoing.client_submission_id ?? "",
            confirmed,
          ),
        );
      } catch (error) {
        setMessages((current) =>
          markSendFailed(current, outgoing.client_submission_id ?? ""),
        );

        Toast.show({
          type: "error",
          text1: "Mensagem não enviada",
          text2:
            error instanceof ApiError
              ? error.message
              : "Verifique sua conexão e toque na mensagem para reenviar.",
          position: "top",
        });
      }
    },
    [adoptThreadId, businessId, user?.driverId],
  );

  const buildOptimistic = useCallback(
    (input: SendInput, orderOffset: number): ClientChatMessage => {
      const clientSubmissionId = randomUUID();

      return {
        id: `local-${clientSubmissionId}`,
        kind: input.kind,
        body: "body" in input && input.body ? input.body : null,
        attachment_url: input.kind !== "TEXT" ? input.uri : null,
        duration_ms: input.kind === "AUDIO" ? input.durationMs : null,
        deliveryId: "deliveryId" in input ? (input.deliveryId ?? null) : null,
        broadcast_id: null,
        client_submission_id: clientSubmissionId,
        threadId: threadIdRef.current ?? "",
        senderId: myUserId,
        sender: { id: myUserId, name: user?.name ?? "Você" },
        delivery: null,
        // A millisecond apart per position: a batch built inside one tick
        // would otherwise share a timestamp, and the tie-break is the id —
        // which would scatter the photos into an order nobody chose.
        created_at: new Date(Date.now() + orderOffset).toISOString(),
        pending: true,
        localUri: input.kind !== "TEXT" ? input.uri : undefined,
        localFileSize: input.kind !== "TEXT" ? input.fileSize : undefined,
        localMimeType:
          input.kind === "IMAGE" ? (input.mimeType ?? undefined) : undefined,
      };
    },
    [myUserId, user?.name],
  );

  /**
   * Sends a batch as one bubble per item, in order.
   *
   * Every item gets its own submission id, so the API's idempotency covers
   * each of them separately and a retry of one cannot duplicate another.
   *
   * The uploads are SEQUENTIAL, not parallel. Ten simultaneous PUTs from a
   * truck stuck on 3G is how a batch half-lands, and the order the driver
   * picked has to survive to the server — the caption rides on the last
   * photo, and a caption that overtakes its images is nonsense. `performSend`
   * settles rather than throws, so one failure marks its own bubble failed,
   * offers its own retry, and the rest of the batch carries on.
   */
  const sendMany = useCallback(
    (inputs: SendInput[]) => {
      if (inputs.length === 0) return;

      const outgoing = inputs.map((input, index) =>
        buildOptimistic(input, index),
      );

      setMessages((current) => [...current, ...outgoing]);

      void (async () => {
        for (const message of outgoing) {
          await performSend(message);
        }
      })();
    },
    [buildOptimistic, performSend],
  );

  const send = useCallback(
    (input: SendInput) => sendMany([input]),
    [sendMany],
  );

  const retry = useCallback(
    (failed: ClientChatMessage) => {
      if (!failed.client_submission_id) return;

      setMessages((current) =>
        markSendPending(current, failed.client_submission_id!),
      );

      // The same submission id makes the retry a no-op if the first attempt
      // actually landed — the API answers with the existing message.
      void performSend({ ...failed, pending: true, failed: false });
    },
    [performSend],
  );

  // The one line the screen has, and the two hints that may both want it.
  const staffHint = chatPresenceHint({
    isTyping: staffTyping,
    isRecording: staffRecording,
  });

  return {
    myUserId,
    messages,
    threadId,
    hasOlder: Boolean(nextCursor),
    counterpartReadAt,
    counterpartDeliveredAt,
    staffHint,
    isLoading,
    isLoadingOlder,
    loadError,
    moduleDisabled,
    reload: load,
    renewAttachmentUrl,
    loadOlder,
    send,
    sendMany,
    retry,
    emitTyping,
    emitRecording,
  };
}

export { useChatConversation };
export type { SendInput };
