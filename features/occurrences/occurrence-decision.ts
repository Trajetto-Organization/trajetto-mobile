import Toast from "react-native-toast-message";

import { queryClient } from "@/providers/query-provider";
import { useAuthStore } from "@/store/auth-store";

import { hasDeliveriesAccess } from "@/features/access/module-rules";
import type { MyDeliveriesResponse } from "@/features/deliveries/types";

import {
  decidedDeliveryOf,
  decisionNotice,
  decisionPushNotice,
  occurrenceDecisionOfPush,
  statusAfterDecision,
  withDecision,
  type Decision,
  type DecisionNotice,
  type OccurrenceDecisionEvent,
} from "./authorization-rules";

/**
 * The tower's answer reaching the driver (decision 6.3; contract §5), by
 * socket with the app open and by push with it in the pocket. Both roads end
 * here, so the stop changes the same way whichever arrives first, and the
 * driver is told once.
 */

/** Opens the delivery (still to be worked) or, with null, the day's list. */
type Navigate = (deliveryId: string | null) => void;

// Per process: the socket frame and the push of the same answer both arrive
// while the app is open. Bounded — a shift has a handful of answers.
const announced: string[] = [];
const ANNOUNCED_LIMIT = 50;

function firstAnnouncement(occurrenceId: string): boolean {
  if (announced.includes(occurrenceId)) return false;

  announced.push(occurrenceId);
  if (announced.length > ANNOUNCED_LIMIT) announced.shift();

  return true;
}

interface Answer {
  occurrenceId: string;
  decision: Decision;

  /** The delivery when the road names it (the socket, a push's `entityId`). */
  deliveryId: string | null;

  /** Undefined when the road does not carry it (the push). */
  note?: string | null;

  /** The delivery's status after the decision, when the road says it. */
  deliveryStatus: string | null;
}

/**
 * The answer on the cached day, then a reread. The notice is built from the
 * row BEFORE both: an approval that failed the delivery drops it from the
 * list, and "sua entrega" is all that would be left to say.
 */
function applyToDay(
  businessId: string,
  answer: Answer,
): { notice: DecisionNotice; openable: string | null; deliveryStatus: string | null } {
  const key = ["my-deliveries", businessId];
  const cached = queryClient.getQueryData<MyDeliveriesResponse>(key);
  const delivery = decidedDeliveryOf(cached?.data ?? [], answer);

  // The push has no status: read from the decided type when the day knows it.
  const deliveryStatus = statusAfterDecision(
    answer,
    delivery,
    cached?.occurrence_types ?? [],
  );

  const notice = decisionNotice(
    {
      decision: answer.decision,
      note: answer.note ?? null,
      deliveryStatus,
    },
    delivery,
  );

  queryClient.setQueryData<MyDeliveriesResponse>(key, (current) =>
    current
      ? {
          ...current,
          data: withDecision(current.data, {
            occurrenceId: answer.occurrenceId,
            decision: answer.decision,
            note: answer.note,
            decidedAt: new Date().toISOString(),
          }),
        }
      : current,
  );

  void queryClient.invalidateQueries({ queryKey: key }).catch(() => undefined);

  // Worth opening only while it is still on the driver's list to work.
  const stillActive =
    deliveryStatus === null ||
    deliveryStatus === "PENDING" ||
    deliveryStatus === "IN_TRANSIT";

  return { notice, openable: delivery && stillActive ? delivery.id : null, deliveryStatus };
}

const showNotice = (notice: DecisionNotice, onPress: () => void) =>
  Toast.show({
    type: notice.type,
    text1: notice.title,
    text2: notice.message,
    position: "top",
    visibilityTime: 8000,
    onPress,
  });

/** The socket's `occurrence.authorization_decided`, with the app open. */
function handleOccurrenceDecisionEvent(
  event: OccurrenceDecisionEvent,
  businessId: string,
  navigate: Navigate,
): void {
  const { notice, openable } = applyToDay(businessId, {
    occurrenceId: event.occurrenceId,
    decision: event.decision,
    deliveryId: event.deliveryId,
    note: event.note ?? null,
    deliveryStatus: typeof event.deliveryStatus === "string" ? event.deliveryStatus : null,
  });

  if (!firstAnnouncement(event.occurrenceId)) return;

  showNotice(notice, () => navigate(openable));
}

interface PushContentLike {
  title?: string | null;
  body?: string | null;
  data?: unknown;
}

/** The push's answer on the day of the driver signed in now, if theirs to see. */
function applyPush(content: PushContentLike | null | undefined) {
  const push = occurrenceDecisionOfPush(content);
  const user = useAuthStore.getState().user;

  if (!push || !user?.businessId || !hasDeliveriesAccess(user)) return null;

  const applied = applyToDay(user.businessId, {
    occurrenceId: push.occurrenceId,
    decision: push.decision,
    deliveryId: push.entityId,
    deliveryStatus: push.deliveryStatus,
  });

  return { push, ...applied };
}

/**
 * The decision push received with the app open. The system banner is off in
 * the foreground (the socket toast usually says it), so this is what shows it
 * when the socket was down — in the push's own words, since the reason
 * travels in its body, except for an approval that ended the delivery,
 * whose body still says "pode seguir" (`decisionPushNotice`). Returns
 * whether the push was a decision.
 */
function handleOccurrenceDecisionPush(
  content: PushContentLike | null | undefined,
  navigate: Navigate,
): boolean {
  const applied = applyPush(content);
  if (!applied) return false;

  const { push, notice, openable, deliveryStatus } = applied;

  if (firstAnnouncement(push.occurrenceId)) {
    showNotice(decisionPushNotice(push, notice, deliveryStatus), () => navigate(openable));
  }

  return true;
}

/**
 * A decision push tapped in the tray: the stop changes (the answer was read
 * in the tray, so no toast) and the driver lands on the delivery when this
 * phone knows it, on the day's list otherwise. Returns whether it was a
 * decision push this session may open.
 */
function openOccurrenceDecisionPush(
  content: PushContentLike | null | undefined,
  navigate: Navigate,
): boolean {
  const applied = applyPush(content);
  if (!applied) return false;

  firstAnnouncement(applied.push.occurrenceId);
  navigate(applied.openable);

  return true;
}

export {
  handleOccurrenceDecisionEvent,
  handleOccurrenceDecisionPush,
  openOccurrenceDecisionPush,
};
export type { Navigate };
