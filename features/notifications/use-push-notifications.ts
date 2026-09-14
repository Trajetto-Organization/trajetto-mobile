import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";

import { useRouter } from "expo-router";

import { apiClient } from "@/utils/api";
import { logger } from "@/utils/logger";

import { setRegisteredPushToken } from "@/utils/push-token";

/**
 * expo-notifications is imported LAZILY on purpose: merely importing the
 * module inside Expo Go on Android fires a red "removed from Expo Go" error
 * at boot (an import-time side effect registers a push token listener).
 * Remote push needs a development build since SDK 53, so in Expo Go this
 * whole feature stays a silent no-op — nothing imported, nothing logged red.
 */
type NotificationsModule = typeof import("expo-notifications");

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let notificationsModule: Promise<NotificationsModule> | null = null;

const loadNotifications = (): Promise<NotificationsModule> => {
  notificationsModule = notificationsModule ?? import("expo-notifications");
  return notificationsModule;
};

/**
 * Registers this device for remote push and sends the token to the API.
 *
 * Silently a no-op where push cannot work: Expo Go, emulators without
 * Google services and denied permission. Push is an enhancement — its
 * absence must never break the app.
 */
async function registerDeviceForPush(): Promise<void> {
  if (!Device.isDevice) return;

  const Notifications = await loadNotifications();

  // Foreground behavior: the socket toast already announces new
  // notifications while the app is open — a system banner on top would say
  // the same thing twice. The tray/list still gets the entry for later.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });

  const currentPermission = await Notifications.getPermissionsAsync();

  const status =
    currentPermission.status === "granted"
      ? currentPermission.status
      : (await Notifications.requestPermissionsAsync()).status;

  if (status !== "granted") return;

  if (Platform.OS === "android") {
    // The channel the API targets (channelId "default" on every message).
    await Notifications.setNotificationChannelAsync("default", {
      name: "Notificações",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#2563eb",
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as
    | string
    | undefined;

  if (!projectId) {
    logger.dev("push: EAS projectId ausente — registro ignorado");
    return;
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  await apiClient.request("/notification/push-token", {
    method: "POST",
    body: { token, platform: Platform.OS },
  });

  setRegisteredPushToken(token);
  logger.dev("push: dispositivo registrado");
}

/**
 * Push wiring for the protected area: registers the device on login and
 * routes tray taps to the notifications screen — including the cold-start
 * case, where the app is LAUNCHED by the tap and the response listener
 * never fires for it.
 */
function usePushNotifications(): void {
  const router = useRouter();

  // A response can be delivered both by the listener and by the cold-start
  // getter; navigating twice would stack screens.
  const handledResponseRef = useRef<string | null>(null);

  useEffect(() => {
    if (isExpoGo) {
      logger.dev("push: indisponível no Expo Go — use um development build");
      return;
    }

    registerDeviceForPush().catch((error) => {
      logger.dev(
        `push: registro indisponível (${error instanceof Error ? error.message : "erro"})`,
      );
    });
  }, []);

  useEffect(() => {
    if (isExpoGo) return;

    let disposed = false;
    let removeListener: (() => void) | null = null;

    void loadNotifications().then((Notifications) => {
      if (disposed) return;

      const openNotifications = (
        response: import("expo-notifications").NotificationResponse,
      ) => {
        const responseId = response.notification.request.identifier;

        if (handledResponseRef.current === responseId) return;
        handledResponseRef.current = responseId;

        // The payload names its destination: a chat push opens the
        // conversation, everything else opens the notifications list.
        const data = response.notification.request.content.data as
          | { url?: string }
          | undefined;

        router.navigate(data?.url === "/chat" ? "/chat" : "/notifications");
      };

      const subscription =
        Notifications.addNotificationResponseReceivedListener(
          openNotifications,
        );

      removeListener = () => subscription.remove();

      void Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (response) openNotifications(response);
        })
        .catch(() => undefined);
    });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [router]);
}

export { usePushNotifications };
