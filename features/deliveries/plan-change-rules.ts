/**
 * A released route's plan changed by the dispatcher (route design §6.3–§6.4).
 *
 * Pure: which routes the phone has to be told about, and in which words.
 * `my-deliveries` carries `routes: [{ id, code, plan_version }]` (design §4.13)
 * and `routeEvent` `route.stops_changed` carries the same version as
 * `planVersion`, so both roads compare the same number.
 */

/** One entry of `my-deliveries` `routes`. */
interface RoutePlanVersion {
  id: string;
  code?: number | null;
  plan_version: number;
}

const PLAN_CHANGED_TITLE = "Rota alterada";

function planChangedMessage(code: number | null | undefined): string {
  return typeof code === "number"
    ? `A rota ${code} foi alterada pelo despachante.`
    : "Sua rota foi alterada pelo despachante.";
}

const isPlanVersion = (value: unknown): value is RoutePlanVersion => {
  const row = value as Partial<RoutePlanVersion> | null;

  return (
    typeof row?.id === "string" &&
    typeof row.plan_version === "number" &&
    Number.isFinite(row.plan_version)
  );
};

/**
 * The routes the cached day already knew at an older version.
 *
 * A route new to the phone is not here: that is a release, which has its own
 * toast. Either side without `routes` (a payload cached before the field, or
 * an API that does not send it yet) says nothing.
 */
function plansAhead(
  previous: readonly RoutePlanVersion[] | null | undefined,
  next: readonly RoutePlanVersion[] | null | undefined,
): RoutePlanVersion[] {
  if (!Array.isArray(previous) || !Array.isArray(next)) return [];

  const known = new Map<string, number>();

  for (const row of previous) {
    if (isPlanVersion(row)) known.set(row.id, row.plan_version);
  }

  return next.filter((row) => {
    if (!isPlanVersion(row)) return false;

    const before = known.get(row.id);

    return before !== undefined && row.plan_version > before;
  });
}

/** The key one announcement is remembered under. */
const planChangeKey = (routeId: string, planVersion: number): string =>
  `${routeId}:${planVersion}`;

export { PLAN_CHANGED_TITLE, planChangeKey, planChangedMessage, plansAhead };
export type { RoutePlanVersion };
