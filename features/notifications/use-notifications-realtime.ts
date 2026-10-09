import { useEffect } from "react";
import { AppState } from "react-native";

import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { useRouter } from "expo-router";

import Toast from "react-native-toast-message";

import type { Socket } from "socket.io-client";

import { useAuthStore } from "@/store/auth-store";
import { queryClient } from "@/providers/query-provider";

import { initializeSocket, onRealtimeResync } from "@/utils/socket";

import {
  applyIncomingNotification,
  applyNotificationsRead,
  refreshUnreadCount,
  type AppNotification,
} from "./use-notifications";
import { disconnectNeedsFallbackPoll } from "./notification-rules";
import {
  handleProofFeedbackNotification,
  openProofFeedbackDelivery,
} from "./proof-feedback";

const PUSH_EVENT = "pushNotification";

/** A read on any of the user's devices (API ≥ GAP3-13). */
const READ_EVENT = "notificationsRead";

// The same chime the web plays for a realtime notification — one identity
// across platforms. Created lazily on the first arrival and reused after.
let notificationPlayer: AudioPlayer | null = null;

const playNotificationSound = (): void => {
  try {
    notificationPlayer =
      notificationPlayer ??
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      createAudioPlayer(require("../../assets/sounds/notification.aac"));

    notificationPlayer.seekTo(0);
    notificationPlayer.play();
  } catch {
    // Sound is garnish — a missing audio backend must not break the toast.
  }
};

/**
 * Live notifications while the app is open: the same socket that already
 * carries security events also carries `pushNotification`, so the badge and
 * the list update the moment the server emits — no pull-to-refresh, no app
 * restart. A toast surfaces the arrival and taps through to the list.
 *
 * OS-level push for a closed app is a different feature (Expo push + a PUSH
 * channel in the pipeline) and deliberately not smuggled in here.
 */
function useNotificationsRealtime(): void {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) return;

    let disposed = false;
    let boundSocket: Socket | null = null;

    const handlePush = (incoming: AppNotification) => {
      if (disposed || !incoming?.id) return;

      applyIncomingNotification(queryClient, incoming);

      // A proof warning (decision 6.9) is kept for its delivery, and the
      // toast opens that delivery rather than the list.
      const proofDeliveryId = handleProofFeedbackNotification(
        incoming as unknown as Record<string, unknown>,
      );

      // It comes after the proof reached the server: a list fetched before
      // it may still show the proven delivery in route.
      if (proofDeliveryId) {
        void queryClient
          .invalidateQueries({ queryKey: ["my-deliveries"] })
          .catch(() => undefined);
      }

      // The socket now outlives a short trip to another app (MOB-20), and
      // the system push already rings for what arrives there: a chime from
      // the background would be a second one, over whatever the driver is
      // listening to.
      if (AppState.currentState === "active") playNotificationSound();

      Toast.show({
        type: "info",
        text1: incoming.title,
        text2: incoming.message,
        position: "top",
        // navigate (not push): tapping the toast twice must not stack.
        onPress: () => {
          if (
            proofDeliveryId &&
            openProofFeedbackDelivery(router, proofDeliveryId, { viaList: false })
          ) {
            return;
          }

          router.navigate("/notifications");
        },
      });
    };

    const handleRead = (payload?: { notificationId?: string | null }) => {
      if (disposed) return;

      applyNotificationsRead(queryClient, payload);
    };

    // The badge does not poll while the socket is up; a lost connection has
    // to wake the fallback poll, which React Query only re-reads on a fetch.
    const handleDisconnect = (reason: string) => {
      if (disposed || !disconnectNeedsFallbackPoll(reason)) return;

      refreshUnreadCount(queryClient);
    };

    void initializeSocket()
      .then((socket) => {
        if (disposed) return;

        boundSocket = socket;

        socket.off(PUSH_EVENT, handlePush);
        socket.on(PUSH_EVENT, handlePush);

        socket.off(READ_EVENT, handleRead);
        socket.on(READ_EVENT, handleRead);

        socket.off("disconnect", handleDisconnect);
        socket.on("disconnect", handleDisconnect);
      })
      .catch(() => {
        // The socket provider owns connection retries; without a socket the
        // pull-to-refresh and unread-count polling still keep things honest.
      });

    // A notification emitted while the socket was down never arrives — the
    // API has no replay — so a reconnection asks again for the badge and the
    // list, both under ["notifications"]. No sound or toast: nothing is known
    // about what changed.
    const stopResync = onRealtimeResync(() => {
      if (disposed) return;

      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });

    return () => {
      disposed = true;
      stopResync();
      boundSocket?.off(PUSH_EVENT, handlePush);
      boundSocket?.off(READ_EVENT, handleRead);
      boundSocket?.off("disconnect", handleDisconnect);
    };
  }, [isAuthenticated, router]);
}

export { useNotificationsRealtime };
