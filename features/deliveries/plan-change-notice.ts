import Toast from "react-native-toast-message";

import {
  PLAN_CHANGED_TITLE,
  planChangeKey,
  planChangedMessage,
  plansAhead,
  type RoutePlanVersion,
} from "./plan-change-rules";

/**
 * The one toast that says a released route was changed (route design §6.3–§6.4).
 *
 * Two roads reach it: the live `route.stops_changed` event, and the sync that
 * finds a newer `plan_version` than the cached day. The socket event itself
 * invalidates the list, so without a shared record the refetch it triggers
 * would repeat the toast a second later. Remembered per route and version for
 * the life of the process; after a restart the cache already holds the newer
 * version, so nothing is said twice.
 */
const announced = new Set<string>();

interface PlanChange {
  routeId: string;
  code?: number | null;
  planVersion?: number | null;
}

function announcePlanChange(change: PlanChange): void {
  if (typeof change.planVersion === "number") {
    const key = planChangeKey(change.routeId, change.planVersion);

    if (announced.has(key)) return;
    announced.add(key);
  }

  // No new sound (design §6.3): the toast only.
  Toast.show({
    type: "info",
    text1: PLAN_CHANGED_TITLE,
    text2: planChangedMessage(change.code),
    position: "top",
    visibilityTime: 6000,
  });
}

/** After a sync: the cached `routes` against the ones just read. */
function announcePlanChangesBetween(
  previous: readonly RoutePlanVersion[] | null | undefined,
  next: readonly RoutePlanVersion[] | null | undefined,
): void {
  for (const route of plansAhead(previous, next)) {
    announcePlanChange({
      routeId: route.id,
      code: route.code,
      planVersion: route.plan_version,
    });
  }
}

/** Tests only. */
function resetAnnouncedPlanChanges(): void {
  announced.clear();
}

export { announcePlanChange, announcePlanChangesBetween, resetAnnouncedPlanChanges };
