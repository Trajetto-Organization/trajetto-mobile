import { useEffect, useMemo, useRef, useState } from "react";

import * as Haptics from "expo-haptics";
import Toast from "react-native-toast-message";

import { hasDeliveriesAccess } from "@/features/access/module-rules";
import { queuedNotice } from "@/features/submissions/queue-decision";

import { useAuthStore } from "@/store/auth-store";
import { useOutboxStore } from "@/store/outbox-store";

import { markStopOnTheWay } from "../on-the-way-actions";
import { onTheWayView, type ConfirmedMark, type OnTheWayView } from "../on-the-way-rules";
import {
  hydrateOnTheWayStore,
  onTheWayScope,
  useOnTheWayStore,
} from "../on-the-way-store";
import { stopOf } from "../delivery-rules";
import type { DriverDelivery, DriverOccurrenceType } from "../types";

const NO_MARKS: Readonly<Record<string, ConfirmedMark>> = {};
const NOTHING: OnTheWayView = { offer: false, current: false, since: null, queued: false };

/**
 * An occurrence type that takes the stop out of PENDING on the API: it blocks
 * the delivery and applies at once (one waiting for the tower's authorization
 * applies nothing until approved, decision 6.3).
 */
const blockingTypeIds = (types: readonly DriverOccurrenceType[]): Set<string> =>
  new Set(
    types
      .filter((type) => type.blocks_delivery === true && type.requires_authorization !== true)
      .map((type) => type.id),
  );

/**
 * "Estou a caminho" on the delivery screen (decision 6.4): what to show for
 * one stop, and the tap. Only for a driver of a company with Entregas — the
 * API's gate (driver session, module DELIVERIES) read from the same session.
 */
function useOnTheWay(businessId: string) {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id ?? "";
  const enabled = hasDeliveriesAccess(user) && Boolean(userId) && Boolean(businessId);
  const scope = onTheWayScope(userId, businessId);

  const [ready, setReady] = useState<boolean>(() => useOnTheWayStore.persist.hasHydrated());
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // One tap in flight: a second before the first settles would be a second
  // key, and a second event on the stop.
  const inFlight = useRef<boolean>(false);

  useEffect(() => {
    if (ready) return;

    let active = true;
    void hydrateOnTheWayStore().then(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
    };
  }, [ready]);

  const confirmed = useOnTheWayStore((state) => state.byScope[scope] ?? NO_MARKS);

  const items = useOutboxStore((state) => state.items);
  const queue = useMemo(
    () => items.filter((item) => item.ownerUserId === userId && item.businessId === businessId),
    [items, userId, businessId],
  );

  const viewFor = (
    delivery: DriverDelivery,
    deliveries: readonly DriverDelivery[],
    occurrenceTypes: readonly DriverOccurrenceType[],
  ): OnTheWayView => {
    if (!enabled || !ready) return NOTHING;

    return onTheWayView(delivery, {
      deliveries,
      confirmed,
      queue,
      blockingTypeIds: blockingTypeIds(occurrenceTypes),
    });
  };

  const mark = async (delivery: DriverDelivery): Promise<boolean> => {
    const stop = stopOf(delivery);

    if (!enabled || !stop || inFlight.current) return false;

    inFlight.current = true;
    setIsSubmitting(true);

    try {
      const result = await markStopOnTheWay(
        { userId, businessId },
        {
          deliveryId: delivery.id,
          stopId: stop.id,
          routeId: stop.route.id,
          recipientName: delivery.recipient_name,
        },
      );

      switch (result.status) {
        case "sent":
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          Toast.show({
            type: "success",
            text1: "A caminho!",
            text2: "A base já vê que você está indo para este endereço.",
            position: "top",
            visibilityTime: 3000,
          });
          return true;

        case "queued":
        case "queued-signed-out":
        case "queued-until-update":
          Toast.show({
            type: "info",
            text1: "A caminho salvo no aparelho",
            text2: queuedNotice(result.status),
            position: "top",
            visibilityTime: result.status === "queued" ? 4000 : 6000,
          });
          return true;

        case "moot":
          Toast.show({
            type: "info",
            text1: "Não é mais preciso avisar",
            text2: result.message,
            position: "top",
            visibilityTime: 6000,
          });
          return false;

        case "refused":
          Toast.show({
            type: "error",
            text1: "Não foi possível avisar que está a caminho.",
            text2: result.message,
            position: "top",
            visibilityTime: 6000,
          });
          return false;
      }
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };

  return { viewFor, mark, isSubmitting };
}

export { useOnTheWay };
