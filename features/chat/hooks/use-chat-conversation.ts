import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";

import Toast from "react-native-toast-message";
import type { Socket } from "socket.io-client";

import { useAuthStore } from "@/store/auth-store";

import { apiClient, ApiError } from "@/utils/api";
import { getSocket, initializeSocket, onRealtimeResync } from "@/utils/socket";

import { uploadToStorage } from "@/features/media/upload-to-storage";

import {
  chatHintPulseMs,
  chatHintTtlMs,
  chatPresenceHint,
  clearGapMarks,
  confirmOptimistic,
  findOptimisticCopy,
  latestIso,
  markSendFailed,
  markSendPending,
  mergeIncomingMessage,
  mergeNewestPage,
  newestDeliverableAt,
  presencePulseIsDue,
  readCursorFor,
  takeNewestPage,
  type ChatHistory,
} from "../chat-rules";

import {
  chatContextBody,
  chatContextFields,
  citesRefusedContext,
  isStaleContextRejection,
  staleContextNotice,
  rememberRefusedContext,
  stripChatContext,
  type ChatContext,
  type ChatContextReference,
} from "../chat-context";

import { CHAT_COALESCE_MS, createCursorCoalescer } from "../coalesce";

import {
  createConversationSync,
  type ConversationSyncTrigger,
} from "../conversation-sync";

import { setConversationFocused } from "../conversation-presence";
import { refreshLinkedChatMessages } from "../linked-messages";
import { markChatDelivered } from "../mark-delivered";
import { seedChatAudioCache } from "../audio-cache";
import {
  applyChatRead,
  applyTicketEvent,
  mergeTicketReadCursors,
  mergeTickets,
  type ChatReadCursors,
  type DriverTicketEvent,
  type TicketLike,
} from "../ticket-rules";

import {
  holdChatUnreadRefresh,
  requestChatUnreadRefresh,
} from "../unread-refresh";

import type {
  ChatDeliveredEvent,
  ChatMessage,
  ChatMessagesResponse,
  ClientChatMessage,
} from "../types";

interface SendTextInput {
  kind: "TEXT";
  body: string;
  context?: ChatContext | null;
}

interface SendImageInput {
  kind: "IMAGE";
  body?: string;
  uri: string;
  fileName?: string | null;
  fileSize?: number;
  mimeType?: string | null;
  context?: ChatContext | null;
}

interface SendAudioInput {
  kind: "AUDIO";
  uri: string;
  durationMs: number;
  fileSize?: number;

  // A voice note is about a delivery as often as a typed one is — more often,
  // since speaking is what a driver does with their hands full.
  context?: ChatContext | null;
}

interface ChatConversationOptions {
  /**
   * The API refused a message only for the delivery or route it cited
   * (`refused`). The screen drops its chip when it still cites that: every
   * next message would be refused the same way.
   */
  onContextRejected?: (refused: ChatContextReference) => void;
}

type SendInput = SendTextInput | SendImageInput | SendAudioInput;

/** The newest page, the same size the screen opens with. */
const PAGE_LIMIT = 40;

const EMPTY_HISTORY: ChatHistory = { messages: [], nextCursor: null };

/**
 * Files a voice note recorded on this phone under the id the server just gave
 * it, before the optimistic row it replaces disappears (MOB-21).
 *
 * The socket echo of the driver's own send often lands BEFORE the HTTP answer,
 * and the bubble remounts under the server id the moment the swap happens. If
 * the cache has not heard of that id by then, the driver's own note comes back
 * with a download arrow. Seeding is idempotent, so the HTTP path doing it
 * again later costs a stat.
 */
function seedOwnVoiceNote(
  list: ClientChatMessage[],
  incoming: ChatMessage,
): void {
  const optimistic = findOptimisticCopy(list, incoming);

  if (!optimistic || optimistic.kind !== "AUDIO") return;

  const localUri = optimistic.localUri ?? optimistic.attachment_url;

  if (localUri) seedChatAudioCache(incoming.id, localUri);
}

/**
 * The driver's single conversation with the operation, live end to end:
 * history by cursor, optimistic sends with a safe retry (the submission id
 * makes a duplicate impossible), read cursors both ways and the staff's
 * "digitando..." / "gravando um áudio...". Sending needs a connection — the outbox stays the
 * delivery loop's tool; a chat is a conversation, not an appointment.
 *
 * The screen stays mounted as a tab and the socket is paused in the
 * background, while the API has no replay. So the conversation goes back to
 * the server for what it missed whenever something may have been missed — a
 * reconnection, the socket's first connection after a load made without it,
 * a return to the foreground, the tab being focused again, a pull on the
 * list — and FOLDS the newest page into what is on screen instead of
 * replacing it (MOB-05). `createConversationSync` decides which of those are
 * worth a request.
 */
function useChatConversation(options: ChatConversationOptions = {}) {
  const user = useAuthStore((state) => state.user);

  // Read at the moment of the refusal: the screen passes a fresh closure on
  // every render, and the send callbacks must not be rebuilt for it. Synced
  // in an effect, not during render (the React Compiler forbids that write).
  const onContextRejectedRef = useRef(options.onContextRejected);

  useEffect(() => {
    onContextRejectedRef.current = options.onContextRejected;
  }, [options.onContextRejected]);

  const myUserId = user?.id ?? "";
  const businessId = user?.businessId ?? "";

  // Messages and the paging cursor move together: a resync that finds a gap
  // replaces both in one update, so they live in one piece of state.
  const [history, setHistory] = useState<ChatHistory>(EMPTY_HISTORY);

  const messages = history.messages;
  const nextCursor = history.nextCursor;

  const [threadId, setThreadId] = useState<string | null>(null);

  /** Decision 14.5: the subjects the messages on screen belong to. */
  const [tickets, setTickets] = useState<Map<string, TicketLike>>(() => new Map());

  // The tower's read cursors: the thread's, and one per ticket (decision
  // 14.5 — reading a ticket moves only that ticket's). A message's blue
  // check is the later of the two (`readCursorOf`).
  const [readCursors, setReadCursors] = useState<ChatReadCursors>(() => ({
    thread: null,
    tickets: {},
  }));
  const counterpartReadAt = readCursors.thread;

  // How far the SAC has confirmed RECEIVING what the driver sent — the grey
  // double check. A different cursor from the read one above, and the two
  // move independently.
  const [counterpartDeliveredAt, setCounterpartDeliveredAt] = useState<
    string | null
  >(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

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

  // What is on screen, readable from socket handlers and effects without
  // rebuilding them on every message.
  const messagesRef = useRef<ClientChatMessage[]>(messages);

  // The conversation has been shown at least once. Until then there is no
  // list on screen to resync — a trigger retries the first load instead.
  const loadedRef = useRef<boolean>(false);

  // The list is scrolled to its newest message (reported by the screen). A
  // driver reading older history has not seen what lands below the fold.
  const viewingLatestRef = useRef<boolean>(true);

  // Identity for the "conversation on screen" registry (`useChatRealtime`
  // reads it to skip a GET this hook already makes).
  const [presenceOwner] = useState<object>(() => ({}));

  // The newest instant already confirmed as delivered. Reloads that bring
  // nothing new must not re-confirm the same cursor on every render.
  const deliveredUpToRef = useRef<string | null>(null);

  const staffTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const staffRecordingTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  /** When the driver's own "digitando" last went out, or `null` for never. */
  const lastTypingEmitRef = useRef<number | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /** Every existing call site edits the message list; the cursor rides along. */
  const setMessages = useCallback(
    (update: (current: ClientChatMessage[]) => ClientChatMessage[]) => {
      setHistory((current) => {
        const next = update(current.messages);

        return next === current.messages
          ? current
          : { messages: next, nextCursor: current.nextCursor };
      });
    },
    [],
  );

  /**
   * The read cursor, one POST per burst (MOB-09) carrying the newest instant
   * actually on screen (MOB-05). A broadcast of twenty messages used to be
   * twenty `mark-read` calls, each refetching the badge; the coalescer keeps
   * the latest instant of the window and posts it once. It holds the badge
   * while the POST is on its way, so the arrival's own refetch request and
   * this one become a single `list-threads` after the cursor moved.
   */
  const [readCursor] = useState(() =>
    createCursorCoalescer({
      windowMs: CHAT_COALESCE_MS,
      hold: holdChatUnreadRefresh,
      flush: async (readAt) => {
        const thread = threadIdRef.current;

        if (!thread) return;

        await apiClient.post("/chat/mark-read", { threadId: thread, readAt });

        // The hub badge derives from the cursor just advanced.
        requestChatUnreadRefresh();
      },
    }),
  );

  useEffect(() => () => readCursor.cancel(), [readCursor]);

  /**
   * Reports as read what the driver is really looking at: the conversation
   * is the focused screen, the app is in the foreground, the list is on
   * screen (not the spinner, not an error) and scrolled to its newest
   * message. Anything else stays unread — a message merged in by a resync
   * while the driver is on the map, or one that landed below the fold while
   * they read older history, has not been seen, and the SAC must not be told
   * it was. The cursor only advances, so the older messages the driver is
   * reading were already reported when they were the newest on screen.
   */
  const markDisplayedAsRead = useCallback(
    (displayed: ClientChatMessage[]) => {
      if (!loadedRef.current) return;
      if (!focusedRef.current) return;
      if (AppState.currentState !== "active") return;
      if (!viewingLatestRef.current) return;

      const readAt = readCursorFor(displayed, myUserId);

      if (readAt) readCursor.push(readAt);
    },
    [myUserId, readCursor],
  );

  /**
   * The screen reports whether the list is at its newest message. Coming
   * back down reads whatever landed below the fold meanwhile.
   */
  const setViewingLatest = useCallback(
    (viewing: boolean) => {
      if (viewingLatestRef.current === viewing) return;

      viewingLatestRef.current = viewing;

      if (viewing) markDisplayedAsRead(messagesRef.current);
    },
    [markDisplayedAsRead],
  );

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

  /** Everything a page from the server says besides the messages themselves. */
  const absorbPageMeta = useCallback(
    (response: ChatMessagesResponse) => {
      // Advance-only: a page can answer with a snapshot older than a
      // `chatRead` event already applied.
      setReadCursors((current) => ({
        thread: latestIso(current.thread, response.counterpartLastReadAt),
        tickets: mergeTicketReadCursors(current.tickets, response.counterpartTicketReadAt),
      }));
      advanceDeliveredCursor(response.counterpartDeliveredAt);

      adoptThreadId(response.threadId);

      // The subjects of this page, for the separators (an older API sends none).
      setTickets((current) => mergeTickets(current, response.tickets));

      if (response.threadId) {
        confirmDelivery(response.threadId, response.data);
      }
    },
    [adoptThreadId, advanceDeliveredCursor, confirmDelivery],
  );

  // ======================================================== sync control
  // Whatever runs a sync changes identity with its dependencies; the
  // controller below is created once, so it reads the current one from here.
  const runSyncRef = useRef<
    (trigger: ConversationSyncTrigger) => Promise<boolean>
  >(async () => false);

  const [sync] = useState(() =>
    createConversationSync({
      run: (trigger) => runSyncRef.current(trigger),
      isOnScreen: () =>
        focusedRef.current && AppState.currentState === "active",
      isLive: () => getSocket()?.connected ?? false,
    }),
  );

  // =============================================================== load
  /**
   * The first load (and a retry of one that failed). `quiet` is for a
   * background retry: it keeps the screen as it is instead of flashing the
   * spinner on every reconnection.
   *
   * The page becomes the history, but the socket is already live while the
   * GET is in flight: whatever it delivered meanwhile is newer than the page
   * and is kept (`takeNewestPage`). Always called through `sync`, so a
   * reconnection that lands during this GET runs once it ends instead of
   * being dropped.
   */
  const fetchInitial = useCallback(
    async (quiet: boolean): Promise<boolean> => {
      if (!quiet) {
        setIsLoading(true);
        setLoadError("");
        setModuleDisabled(false);
      }

      try {
        const response = await apiClient.get<ChatMessagesResponse>(
          `/chat/list-messages?limit=${PAGE_LIMIT}`,
        );

        // Seeded before the swap, like any other arrival of an own send.
        response.data.forEach((message) =>
          seedOwnVoiceNote(messagesRef.current, message),
        );

        const closesGap = sync.closesGap();

        setHistory((current) => {
          const next = takeNewestPage(current.messages, response);

          return closesGap
            ? {
                messages: clearGapMarks(next.messages),
                nextCursor: next.nextCursor,
              }
            : next;
        });

        loadedRef.current = true;

        setLoadError("");
        setModuleDisabled(false);

        absorbPageMeta(response);

        // What the socket merged during the GET is on screen too — and no
        // longer above a hole when the socket was up all along.
        markDisplayedAsRead([
          ...response.data,
          ...(closesGap
            ? clearGapMarks(messagesRef.current)
            : messagesRef.current),
        ]);

        return true;
      } catch (error) {
        if (error instanceof ApiError && error.code === "MODULE_NOT_ENABLED") {
          loadedRef.current = false;
          setModuleDisabled(true);
        } else if (!quiet) {
          setLoadError(
            error instanceof ApiError
              ? error.message
              : "Não foi possível carregar a conversa. Verifique sua conexão.",
          );
        }

        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [absorbPageMeta, markDisplayedAsRead, sync],
  );

  /**
   * Catches up with what the server has that this screen does not.
   *
   * The newest page is fetched and FOLDED into the list — the history the
   * driver paged in stays where it is (see `mergeNewestPage`). A failure is
   * silent unless the driver asked for it by pulling the list: a resync is
   * housekeeping, and a readable conversation must never turn into an error
   * screen because a background fetch hit a dead spot.
   */
  const runSync = useCallback(
    async (trigger: ConversationSyncTrigger): Promise<boolean> => {
      if (!loadedRef.current) {
        return fetchInitial(trigger !== "manual" && trigger !== "initial");
      }

      try {
        const response = await apiClient.get<ChatMessagesResponse>(
          `/chat/list-messages?limit=${PAGE_LIMIT}`,
        );

        response.data.forEach((message) =>
          seedOwnVoiceNote(messagesRef.current, message),
        );

        // Began with the socket up and nothing dropped since: this page and
        // the live arrivals together are the whole thread.
        const closesGap = sync.closesGap();

        setHistory((current) => {
          const merged = mergeNewestPage(
            current.messages,
            current.nextCursor,
            response,
          );

          const next = closesGap
            ? {
                messages: clearGapMarks(merged.messages),
                nextCursor: merged.nextCursor,
              }
            : merged;

          return next.messages === current.messages &&
            next.nextCursor === current.nextCursor
            ? current
            : next;
        });

        absorbPageMeta(response);

        // The marks came off, so what the socket delivered while this page
        // was on its way is reported too.
        markDisplayedAsRead(
          closesGap
            ? [...response.data, ...clearGapMarks(messagesRef.current)]
            : response.data,
        );

        return true;
      } catch (error) {
        if (error instanceof ApiError && error.code === "MODULE_NOT_ENABLED") {
          loadedRef.current = false;
          setModuleDisabled(true);

          return false;
        }

        if (trigger === "manual") {
          Toast.show({
            type: "error",
            text1: "Não foi possível atualizar a conversa",
            text2: "Verifique sua conexão e tente de novo.",
            position: "top",
          });
        }

        return false;
      }
    },
    [absorbPageMeta, fetchInitial, markDisplayedAsRead, sync],
  );

  // Declared before the load below: effects run in order, and the first
  // load goes through `sync`, which calls whatever this ref holds.
  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  const load = useCallback(() => sync.request("initial"), [sync]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Pull-to-refresh. Never skipped: the driver asked. */
  const refresh = useCallback(async () => {
    setIsRefreshing(true);

    try {
      await sync.request("manual");
    } finally {
      setIsRefreshing(false);
    }
  }, [sync]);

  // A reconnection is the one signal that something WAS missed: the API has
  // no replay, so whatever the SAC sent while the socket was down is only on
  // the server. Off screen it is owed to the next focus or foreground rather
  // than fetched for nobody (see `createConversationSync`).
  useEffect(() => onRealtimeResync(() => void sync.request("resync")), [sync]);

  // Back from the background with the conversation on screen: what was merged
  // meanwhile is now in front of the driver, and whatever the paused socket
  // missed is fetched.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active" || !focusedRef.current) return;

      markDisplayedAsRead(messagesRef.current);
      void sync.request("foreground");
    });

    return () => subscription.remove();
  }, [markDisplayedAsRead, sync]);

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
    [setMessages],
  );

  const loadOlder = useCallback(async () => {
    if (!nextCursor || !threadIdRef.current || isLoadingOlder) return;

    const cursor = nextCursor;

    setIsLoadingOlder(true);

    try {
      const query = new URLSearchParams({
        threadId: threadIdRef.current,
        limit: String(PAGE_LIMIT),
        beforeAt: cursor.created_at,
        beforeId: cursor.id,
      });

      const response = await apiClient.get<ChatMessagesResponse>(
        `/chat/list-messages?${query.toString()}`,
      );

      setHistory((current) =>
        // A resync that found a gap replaced the history (and its cursor)
        // while this page was on its way: it belongs to a list that is gone.
        current.nextCursor !== cursor
          ? current
          : {
              messages: [...[...response.data].reverse(), ...current.messages],
              nextCursor: response.nextCursor,
            },
      );

      advanceDeliveredCursor(response.counterpartDeliveredAt);
      setTickets((current) => mergeTickets(current, response.tickets));
      setReadCursors((current) => {
        const tickets = mergeTicketReadCursors(current.tickets, response.counterpartTicketReadAt);

        return tickets === current.tickets ? current : { ...current, tickets };
      });
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

      seedOwnVoiceNote(messagesRef.current, incoming);

      // After a drop, the live socket may deliver the newest message of a
      // thread whose middle it missed; the next catch-up must not take it as
      // proof that the history on screen reaches that far.
      const arrival: ClientChatMessage = sync.trustsLiveArrivals()
        ? incoming
        : { ...incoming, afterGap: true };

      setMessages((current) => mergeIncomingMessage(current, arrival));

      // Through the coalescer: a burst is one `mark-read`, not one per
      // message. The driver's own echo reports nothing, and neither does an
      // arrival above a possible hole (`readCursorFor`).
      if (incoming.senderId !== myUserId) markDisplayedAsRead([arrival]);
    };

    const handleChatRead = (event?: {
      userId?: string;
      last_read_at?: string;
      ticketId?: string | null;
    }) => {
      if (disposed || !event?.last_read_at) return;

      // Only the OTHER side's cursor turns this screen's checks double, and a
      // ticket's read only that ticket's messages.
      setReadCursors((current) => applyChatRead(current, event, myUserId));
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
     * A dropped connection takes both hints down with it, and makes the list
     * stale: until the next sync, what the socket would have carried is only
     * on the server.
     *
     * The hints part is courtesy, not correction: a socket that dies stops
     * delivering pulses, so both hints would go out on their own within their
     * window anyway. This only spares the driver the few seconds of a bubble
     * that already has nobody behind it.
     */
    const handleDisconnect = () => {
      if (disposed) return;

      sync.markStale();

      if (staffTypingTimer.current) clearTimeout(staffTypingTimer.current);

      if (staffRecordingTimer.current) {
        clearTimeout(staffRecordingTimer.current);
      }

      staffTypingTimer.current = null;
      staffRecordingTimer.current = null;

      setStaffTyping(false);
      setStaffRecording(false);
    };

    /**
     * The socket's first connection is not announced as a resync, yet a list
     * loaded before it misses whatever the SAC sent until the room was
     * joined — the cold start from a chat push. The controller decides
     * whether this connection needs a catch-up of its own.
     */
    const handleConnect = () => {
      if (disposed) return;

      void sync.noteConnected();
    };

    // A subject opened, closed or reopened by the central (decision 14.5).
    const handleSupportTicket = (event?: DriverTicketEvent) => {
      if (disposed) return;

      setTickets((current) => applyTicketEvent(current, event));
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
        socket.on("disconnect", handleDisconnect);
        socket.on("connect", handleConnect);
        socket.on("supportTicket", handleSupportTicket);

        // Binding is asynchronous: a connection made since the first load
        // began fired no event this handler could hear.
        if (socket.connected) handleConnect();
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
      boundSocket?.off("disconnect", handleDisconnect);
      boundSocket?.off("connect", handleConnect);
      boundSocket?.off("supportTicket", handleSupportTicket);

      if (staffTypingTimer.current) clearTimeout(staffTypingTimer.current);
      if (staffRecordingTimer.current) {
        clearTimeout(staffRecordingTimer.current);
      }
    };
  }, [
    adoptThreadId,
    advanceDeliveredCursor,
    markDisplayedAsRead,
    myUserId,
    setMessages,
    sync,
  ]);

  // Focus bookkeeping: arriving on the screen reads what is on it and looks
  // for anything missed; messages landing while the screen is behind another
  // one are not read.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setConversationFocused(presenceOwner, true);

      markDisplayedAsRead(messagesRef.current);
      void sync.request("focus");

      return () => {
        focusedRef.current = false;
        setConversationFocused(presenceOwner, false);
      };
    }, [markDisplayedAsRead, presenceOwner, sync]),
  );

  // A focus cleanup is not guaranteed to run before an unmount.
  useEffect(
    () => () => setConversationFocused(presenceOwner, false),
    [presenceOwner],
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
  /**
   * Uploads the attachment, if any, then posts the message.
   *
   * `refused` holds the references the API already refused during this batch:
   * the photos after the first one of a batch about a stale delivery go
   * without it, instead of each being refused on its own.
   */
  const performSend = useCallback(
    async (queued: ClientChatMessage, refused: Set<string> = new Set()) => {
      const submissionId = queued.client_submission_id ?? "";

      let outgoing = citesRefusedContext(queued, refused)
        ? { ...queued, ...chatContextFields(null) }
        : queued;

      if (outgoing !== queued) {
        setMessages((current) => stripChatContext(current, submissionId));
      }

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

        const post = (message: ClientChatMessage) =>
          apiClient.post<{ data: ChatMessage[] }>("/chat/send-message", {
            driverIds: [user?.driverId],
            kind: message.kind,
            ...(message.body && { body: message.body }),
            ...(attachmentKey && { attachmentKey }),
            ...(message.duration_ms && { durationMs: message.duration_ms }),
            // The delivery and/or route it is about (decision 6.7).
            ...chatContextBody(message),
            clientSubmissionId: message.client_submission_id,
          });

        let response: { data: ChatMessage[] };

        try {
          response = await post(outgoing);
        } catch (error) {
          if (!isStaleContextRejection(error, outgoing)) throw error;

          // Refused only for what it cites: the delivery left this driver, or
          // the route was reassigned. Nothing was written (the reference is
          // checked first), so the same words go again under the same
          // submission id, without it. Retried as they were, they would be
          // refused forever.
          rememberRefusedContext(refused, outgoing);

          // Named, so the screen drops only a chip that still cites it.
          const refusedReference = chatContextBody(outgoing);

          outgoing = { ...outgoing, ...chatContextFields(null) };
          setMessages((current) => stripChatContext(current, submissionId));

          onContextRejectedRef.current?.(refusedReference);

          // A closed ticket and a delivery that left the driver read
          // differently (decision 14.5); the words go again either way.
          const notice = staleContextNotice(error);

          Toast.show({
            type: "info",
            text1: notice.title,
            text2: notice.text,
            position: "top",
          });

          response = await post(outgoing);
        }

        const confirmed = response.data[0];

        // The recording is already on this phone; file it under the id the
        // server just issued, or the driver's own note would come back asking
        // to be downloaded the moment the optimistic row is replaced. (The
        // socket echo may have done it first — see `seedOwnVoiceNote`.)
        if (outgoing.kind === "AUDIO" && confirmed?.id) {
          seedChatAudioCache(
            confirmed.id,
            outgoing.localUri ?? outgoing.attachment_url ?? "",
          );
        }

        adoptThreadId(confirmed.threadId);

        // The previews of its delivery and route now have this one.
        refreshLinkedChatMessages(confirmed);

        setMessages((current) =>
          confirmOptimistic(current, submissionId, confirmed),
        );
      } catch (error) {
        setMessages((current) => markSendFailed(current, submissionId));

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
    [adoptThreadId, businessId, setMessages, user?.driverId],
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
        // Shown on the bubble at once; the confirmed message replaces it.
        ...chatContextFields(input.context),
        broadcast_id: null,
        client_submission_id: clientSubmissionId,
        threadId: threadIdRef.current ?? "",
        senderId: myUserId,
        sender: { id: myUserId, name: user?.name ?? "Você" },
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
        // One batch, one verdict on its reference (see performSend).
        const refused = new Set<string>();

        for (const message of outgoing) {
          await performSend(message, refused);
        }
      })();
    },
    [buildOptimistic, performSend, setMessages],
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
    [performSend, setMessages],
  );

  // The one line the screen has, and the two hints that may both want it.
  const staffHint = chatPresenceHint({
    isTyping: staffTyping,
    isRecording: staffRecording,
  });

  return {
    myUserId,
    messages,
    tickets,
    threadId,
    hasOlder: Boolean(nextCursor),
    counterpartReadAt,
    readCursors,
    counterpartDeliveredAt,
    staffHint,
    isLoading,
    isLoadingOlder,
    isRefreshing,
    loadError,
    moduleDisabled,
    reload: load,
    refresh,
    setViewingLatest,
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
export type { ChatConversationOptions, SendInput };
