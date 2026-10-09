import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { usePathname, useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import type { Socket } from "socket.io-client";

import { useAuthStore } from "@/store/auth-store";

import { apiClient } from "@/utils/api";
import { initializeSocket, socketCarriedLastAbsence } from "@/utils/socket";

import { latestIso, newestDeliverableAt } from "./chat-rules";
import { conversationIsFocused } from "./conversation-presence";
import { markChatDelivered } from "./mark-delivered";
import { requestChatUnreadRefresh } from "./unread-refresh";
import { refreshLinkedChatMessages } from "./linked-messages";

import type { ChatMessage, ChatMessagesResponse } from "./types";

const CHAT_EVENT = "chatMessage";
const CONNECT_EVENT = "connect";

/**
 * How long arrivals are held before a single receipt goes out. A broadcast,
 * or a driver coming back into signal, lands a burst of messages at once —
 * the SAC needs one confirmation carrying the newest timestamp, not twenty.
 * Short enough that the double check still looks instantaneous.
 */
const DELIVERY_COALESCE_MS = 800;

/**
 * The floor between two reconciliations.
 *
 * Every trigger below fires in clusters: a flapping connection emits `connect`
 * again and again, the socket provider reconnects on foreground so `connect`
 * and the AppState change land in the same second, and walking through the app
 * rebuilds the socket effect on every screen. Without this floor one bad
 * tunnel would turn into a request per bounce.
 */
const RECONCILE_MIN_INTERVAL_MS = 10_000;

/** Enough to cover anything that piled up while the app was away. */
const RECONCILE_LIMIT = 30;

/**
 * Chat awareness for the whole protected area: a SAC message arriving while
 * the driver is anywhere else in the app becomes a toast that taps through
 * to the conversation, and the hub badge refreshes. The conversation screen
 * handles its own arrivals — this hook stays quiet there.
 *
 * It also owns the delivery receipt for every arrival, wherever the driver
 * happens to be. That part runs BEFORE the conversation-screen early return
 * on purpose: "the app is open on another screen" is precisely the case the
 * receipt exists for.
 */
function useChatRealtime(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id);

  const router = useRouter();
  const pathname = usePathname();

  // The buffer and its timer live in refs, not in the socket effect: that
  // effect is torn down and rebuilt on every navigation (pathname is a
  // dependency), and a receipt in flight must survive the driver walking
  // through the app.
  const pendingDeliveriesRef = useRef<Map<string, string>>(new Map());
  const deliveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastReconcileAtRef = useRef<number>(0);
  const reconcilingRef = useRef<boolean>(false);

  const flushDeliveries = useCallback(() => {
    deliveryTimerRef.current = null;

    const pending = pendingDeliveriesRef.current;
    pendingDeliveriesRef.current = new Map();

    // One call per thread — the driver has a single one today, but keying by
    // thread costs nothing and keeps the burst collapse honest.
    pending.forEach((deliveredAt, threadId) => {
      void markChatDelivered(threadId, deliveredAt);
    });
  }, []);

  const scheduleDelivery = useCallback(
    (threadId: string, deliveredAt: string) => {
      pendingDeliveriesRef.current.set(
        threadId,
        latestIso(pendingDeliveriesRef.current.get(threadId), deliveredAt) ??
          deliveredAt,
      );

      // A trailing debounce: the first arrival starts the window, everything
      // that lands inside it only raises the timestamp already buffered.
      if (deliveryTimerRef.current) return;

      deliveryTimerRef.current = setTimeout(
        flushDeliveries,
        DELIVERY_COALESCE_MS,
      );
    },
    [flushDeliveries],
  );

  /**
   * Confirms what landed while nobody was listening.
   *
   * The socket only ever confirms what IT delivered, and the conversation
   * screen only confirms what it loads — so a message sent while the driver
   * was logged out or had the app closed stays on a single check until some
   * newer message happens to arrive. Connecting and returning to the
   * foreground are exactly the two moments that gap opens, and both end here.
   *
   * The head of the thread is genuinely DOWNLOADED before anything is
   * confirmed, and the receipt carries the newest `created_at` the server
   * itself issued. That is what makes it honest: the device really is holding
   * those messages. Confirming without fetching — a `Date.now()` receipt and
   * no request — would be cheaper and would be a lie, marking as delivered
   * messages this phone has never seen.
   *
   * With the conversation on screen this steps aside: the conversation
   * fetches the same head of the thread on the same return or reconnection
   * and confirms delivery from it, so a second download would only cost the
   * driver's data plan.
   */
  const reconcileDelivery = useCallback(async () => {
    const now = Date.now();

    if (conversationIsFocused() && AppState.currentState === "active") return;
    if (reconcilingRef.current) return;
    if (now - lastReconcileAtRef.current < RECONCILE_MIN_INTERVAL_MS) return;

    lastReconcileAtRef.current = now;
    reconcilingRef.current = true;

    try {
      const response = await apiClient.get<ChatMessagesResponse>(
        `/chat/list-messages?limit=${RECONCILE_LIMIT}`,
      );

      // The thread is resolved from the token: the driver has exactly one,
      // and it may legitimately not exist yet.
      const deliveredAt = newestDeliverableAt(response.data, userId ?? "");

      if (response.threadId && deliveredAt) {
        // Through the same debounce as the socket arrivals: a reconnection
        // that also brings a burst of messages still costs one receipt.
        scheduleDelivery(response.threadId, deliveredAt);
      }
    } catch {
      // Silent, like the receipt itself. A driver in a dead spot is not an
      // error to show, and the next connect or foreground tries again.
    } finally {
      reconcilingRef.current = false;
    }
  }, [userId, scheduleDelivery]);

  // Only unmounting the protected area drops a pending receipt — by then the
  // session is going away and a late confirmation is worth nothing anyway.
  useEffect(() => {
    return () => {
      if (deliveryTimerRef.current) clearTimeout(deliveryTimerRef.current);

      deliveryTimerRef.current = null;
      pendingDeliveriesRef.current = new Map();
    };
  }, []);

  // The foreground half of the reconciliation. Deliberately its own effect:
  // the socket effect below is rebuilt on every navigation, and re-registering
  // an AppState listener that often is how listeners get leaked.
  useEffect(() => {
    if (!isAuthenticated) return;

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;

      // The socket stayed up through the absence and delivered every
      // message live, receipts included: nothing landed unheard (MOB-20).
      // After a pause, the reconnection's `connect` reconciles anyway.
      if (socketCarriedLastAbsence()) return;

      void reconcileDelivery();
    });

    return () => subscription.remove();
  }, [isAuthenticated, reconcileDelivery]);

  useEffect(() => {
    if (!isAuthenticated) return;

    let disposed = false;
    let boundSocket: Socket | null = null;

    // Covers logging in, a reconnection after signal came back, and the
    // socket provider's reconnect when the app returns to the foreground.
    const handleConnect = () => {
      if (disposed) return;

      void reconcileDelivery();
    };

    const handleChatMessage = (incoming: ChatMessage) => {
      if (disposed || !incoming?.id) return;

      // The driver's own send echoing back is not news.
      if (incoming.senderId === userId) return;

      // The device has it: confirm receipt so the SAC sees the grey double
      // check. Before the pathname return below — this must happen wherever
      // the driver is, and it is silent whether it succeeds or not.
      const deliveredAt = newestDeliverableAt([incoming], userId ?? "");

      if (incoming.threadId && deliveredAt) {
        scheduleDelivery(incoming.threadId, deliveredAt);
      }

      // One badge refetch per burst, shared with the conversation's read
      // cursor: a broadcast is not twenty `list-threads` calls (MOB-09).
      requestChatUnreadRefresh();

      // A message about a delivery or a route: its previews are stale.
      refreshLinkedChatMessages(incoming);

      // On the conversation screen the message is already on screen.
      if (pathname === "/chat") return;

      Toast.show({
        type: "info",
        text1: `💬 ${incoming.sender?.name ?? "SAC"}`,
        text2:
          incoming.body ||
          (incoming.kind === "AUDIO" ? "🎤 Mensagem de voz" : "📷 Foto"),
        position: "top",
        // navigate (not push): tapping the toast twice must not stack.
        onPress: () => router.navigate("/chat"),
      });
    };

    void initializeSocket()
      .then((socket) => {
        if (disposed) return;

        boundSocket = socket;

        socket.off(CHAT_EVENT, handleChatMessage);
        socket.on(CHAT_EVENT, handleChatMessage);

        socket.off(CONNECT_EVENT, handleConnect);
        socket.on(CONNECT_EVENT, handleConnect);

        // Binding to a socket that is already up means no `connect` event is
        // coming, so a backlog would sit there until the next reconnection.
        // The interval floor is what keeps this from firing once per screen
        // the driver walks through.
        if (socket.connected) void reconcileDelivery();
      })
      .catch(() => {
        // The socket provider owns connection retries; the unread badge
        // still refreshes on focus without it.
      });

    return () => {
      disposed = true;

      boundSocket?.off(CHAT_EVENT, handleChatMessage);
      boundSocket?.off(CONNECT_EVENT, handleConnect);
    };
  }, [
    isAuthenticated,
    userId,
    router,
    pathname,
    scheduleDelivery,
    reconcileDelivery,
  ]);
}

export { useChatRealtime };
