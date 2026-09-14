import { useEffect } from "react";

import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { useRouter } from "expo-router";

import Toast from "react-native-toast-message";

import type { Socket } from "socket.io-client";

import { useAuthStore } from "@/store/auth-store";
import { queryClient } from "@/providers/query-provider";

import { initializeSocket } from "@/utils/socket";

import {
  applyIncomingNotification,
  type AppNotification,
} from "./use-notifications";

const PUSH_EVENT = "pushNotification";

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
      playNotificationSound();

      Toast.show({
        type: "info",
        text1: incoming.title,
        text2: incoming.message,
        position: "top",
        // navigate (not push): tapping the toast twice must not stack.
        onPress: () => router.navigate("/notifications"),
      });
    };

    void initializeSocket()
      .then((socket) => {
        if (disposed) return;

        boundSocket = socket;

        socket.off(PUSH_EVENT, handlePush);
        socket.on(PUSH_EVENT, handlePush);
      })
      .catch(() => {
        // The socket provider owns connection retries; without a socket the
        // pull-to-refresh and unread-count polling still keep things honest.
      });

    return () => {
      disposed = true;
      boundSocket?.off(PUSH_EVENT, handlePush);
    };
  }, [isAuthenticated, router]);
}

export { useNotificationsRealtime };
