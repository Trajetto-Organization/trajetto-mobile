import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";

import { useRouter } from "expo-router";

import { apiClient } from "@/utils/api";
import { logger } from "@/utils/logger";

import { setRegisteredPushToken } from "@/utils/push-token";
import { useConnectionStore } from "@/store/connection-store";

import { useAuthStore } from "@/store/auth-store";
import { hasDeliveriesAccess } from "@/features/access/module-rules";

import { createRegistrationRetry } from "./push-registration-retry";
import { createResponseGate, pushDestination } from "./notification-rules";
import { ticketParamsOfPush } from "../chat/ticket-rules";
import {
  openProofFeedbackDelivery,
  rememberProofFeedbackPush,
} from "./proof-feedback";
import { occurrenceDecisionOfPush } from "@/features/occurrences/authorization-rules";

/**
 * The tower's answers to occurrences (decision 6.3), loaded only when one
 * arrives: the handler reaches the query cache and the toasts, which nothing
 * else here needs.
 */
const loadOccurrenceDecisions = () =>
  import("@/features/occurrences/occurrence-decision");

/**
 * Tray taps already acted on — per process, not per mount: the protected
 * layout remounts on every login, and a per-mount record let an old tap
 * navigate again after the next sign-in (MOB-23).
 */
const pushResponses = createResponseGate();

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

  useEffect(() => {
    if (isExpoGo) {
      logger.dev("push: indisponível no Expo Go — use um development build");
      return;
    }

    // Retried until it takes: one lost POST at login left the phone bound to
    // whoever used it before (see push-registration-retry).
    const registration = createRegistrationRetry(
      registerDeviceForPush,
      (error) => {
        logger.dev(
          `push: registro indisponível (${error instanceof Error ? error.message : "erro"})`,
        );
      },
    );

    void registration.attempt();

    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") void registration.attempt();
      },
    );

    const unsubscribeConnection = useConnectionStore.subscribe(
      (current, previous) => {
        const cameBack =
          (previous.isDeviceOffline && !current.isDeviceOffline) ||
          (previous.isApiUnreachable && !current.isApiUnreachable);

        if (cameBack) void registration.attempt();
      },
    );

    return () => {
      registration.stop();
      appStateSubscription.remove();
      unsubscribeConnection();
    };
  }, []);

  useEffect(() => {
    if (isExpoGo) return;

    let disposed = false;
    let removeListener: (() => void) | null = null;

    // Over the day's list, so "back" lands where the driver works.
    const openDecidedDelivery = (deliveryId: string | null) => {
      router.navigate("/deliveries");

      if (deliveryId) {
        router.navigate({ pathname: "/delivery-detail", params: { id: deliveryId } });
      }
    };

    void loadNotifications().then((Notifications) => {
      if (disposed) return;

      const openNotifications = (
        response: import("expo-notifications").NotificationResponse,
      ) => {
        const responseId = response.notification.request.identifier;

        // A response can be delivered both by the listener and by the
        // cold-start getter; navigating twice would stack screens.
        if (!pushResponses.claim(responseId)) return;

        // Handled: the next login must not find it as "the last tap" and be
        // thrown onto the same screen (MOB-23).
        try {
          Notifications.clearLastNotificationResponse();
        } catch {
          // Unavailable on this platform build; the gate above still holds.
        }

        // A proof warning (decision 6.9) opens the delivery it is about,
        // over the day's list, and is kept for that delivery. Dated by when
        // FCM sent it (`google.sent_time` on Android), never by the phone's
        // clock.
        const sentAt = response.notification.date;
        const proofDeliveryId = rememberProofFeedbackPush(
          response.notification.request.content,
          typeof sentAt === "number" && sentAt > 0 ? new Date(sentAt) : null,
        );

        if (
          proofDeliveryId &&
          openProofFeedbackDelivery(router, proofDeliveryId, { viaList: true })
        ) {
          return;
        }

        // The payload names its destination: a chat push opens the
        // conversation, a delivery or route push the day's list, everything
        // else the notifications list.
        const data = response.notification.request.content.data as
          | { url?: string }
          | undefined;

        const openDestination = () => {
          const destination = pushDestination(
            data?.url,
            hasDeliveriesAccess(useAuthStore.getState().user),
          );

          // Decision 14.5: a chat push names its ticket; the chat opens with
          // the composer on that subject.
          const ticketParams = destination === "/chat" ? ticketParamsOfPush(data) : null;

          if (ticketParams) {
            router.navigate({ pathname: "/chat", params: ticketParams });
            return;
          }

          router.navigate(destination);
        };

        // The tower's answer to an occurrence (decision 6.3): the stop
        // changes, and the delivery opens while it is still to be worked.
        const content = response.notification.request.content;

        if (occurrenceDecisionOfPush(content)) {
          void loadOccurrenceDecisions()
            .then(({ openOccurrenceDecisionPush }) =>
              openOccurrenceDecisionPush(content, openDecidedDelivery),
            )
            .catch(() => false)
            .then((handled) => {
              if (!handled) openDestination();
            });

          return;
        }

        openDestination();
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

      // Received with the app open (no system banner in the foreground): the
      // tower's answer still reaches the stop and the screen when the socket
      // was down. Once per answer, whichever road comes first. Last and
      // guarded: without it the socket still brings the answer, and a tap
      // must never lose its listener over this one.
      try {
        const received = Notifications.addNotificationReceivedListener(
          (notification) => {
            const content = notification.request.content;

            if (!occurrenceDecisionOfPush(content)) return;

            void loadOccurrenceDecisions()
              .then(({ handleOccurrenceDecisionPush }) =>
                handleOccurrenceDecisionPush(content, openDecidedDelivery),
              )
              .catch(() => undefined);
          },
        );

        removeListener = () => {
          subscription.remove();
          received.remove();
        };
      } catch {
        // Unavailable on this platform build.
      }
    });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [router]);
}

export { usePushNotifications };
