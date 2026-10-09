/**
 * "Estou a caminho" (decision 6.4), as the app decides it.
 *
 * Pure and import-free, like `delivery-rules`: which stop offers the button,
 * which stop is "a caminho" now and what a refusal from the queue means are
 * decisions a test must read without a phone. The contract is
 * docs/contratos-app/on-the-way.md; the API
 * (`route/usecases/mark-stop-on-the-way`) is the judge.
 */

const ON_THE_WAY_KIND = "delivery-on-the-way" as const;

/** `POST /route/on-the-way/:stopId/route/:routeId/business/:businessId` */
function onTheWayEndpoint(stopId: string, routeId: string, businessId: string): string {
  return `/route/on-the-way/${stopId}/route/${routeId}/business/${businessId}`;
}

const ENDPOINT_PATTERN = /^\/route\/on-the-way\/([^/]+)\/route\/([^/]+)\/business\/([^/]+)$/;

/** The stop and route a queued mark names, read back from its endpoint. */
function onTheWayTarget(endpoint: string): { stopId: string; routeId: string } | null {
  const match = ENDPOINT_PATTERN.exec(endpoint);

  return match ? { stopId: match[1], routeId: match[2] } : null;
}

interface StopOnTheWayState {
  id: string;
  status: string;
  on_the_way_at: string | null | undefined;
}

/**
 * The stop that is "a caminho" right now, or null — the API's rule
 * (`currentOnTheWayStopId` in on-the-way-rules.ts), mirrored.
 *
 * The stop with the route's LATEST mark, and only while it is still PENDING.
 * Marking B after A makes B current; once the latest-marked stop is arrived
 * at or resolved, nothing is current — an older mark does not come back.
 * Ties go to the greater id, so every screen picks the same stop.
 */
function currentOnTheWayStopId(stops: ReadonlyArray<StopOnTheWayState>): string | null {
  let latest: { id: string; status: string; at: number } | null = null;

  for (const stop of stops) {
    if (!stop.on_the_way_at) continue;

    const at = new Date(stop.on_the_way_at).getTime();

    if (Number.isNaN(at)) continue;

    if (!latest || at > latest.at || (at === latest.at && stop.id > latest.id)) {
      latest = { id: stop.id, status: stop.status, at };
    }
  }

  return latest && latest.status === "PENDING" ? latest.id : null;
}

/** A mark the API confirmed, as the phone keeps it (on-the-way-store). */
interface ConfirmedMark {
  routeId: string;

  /** The instant the API recorded: the tap, corrected onto the API's clock. */
  at: string;

  /**
   * The same tap by the phone's clock, kept next to `at` so the pair tells
   * how far off the phone's clock is (`phoneClockSkewMs`).
   */
  tappedAt?: string;
}

/** A queued item, as far as these rules read it. */
interface QueuedItem {
  id?: string;
  kind: string;
  status: string;
  businessId?: string;
  ownerUserId?: string;
  endpoint: string;
  body: Record<string, unknown>;
  createdAt: string;
}

interface OnTheWayStop {
  id: string;
  status: string;
  on_the_way_at?: string | null;
  route: { id: string; status: string };
}

/** A delivery of the day's cached list, as far as these rules read it. */
interface OnTheWayDelivery {
  id: string;
  stops?: OnTheWayStop[] | null;
}

const stopOf = (delivery: OnTheWayDelivery): OnTheWayStop | null =>
  delivery.stops?.[0] ?? null;

/** Not failed: a refused item needs a person, and says nothing happened. */
const counts = (item: QueuedItem): boolean => item.status !== "failed";

const later = (left: string | null, right: string | null | undefined): string | null => {
  if (!right || Number.isNaN(Date.parse(right))) return left;
  if (!left) return right;

  return Date.parse(right) > Date.parse(left) ? right : left;
};

/**
 * How far the phone's clock is behind the API's, in ms, learned from the
 * newest mark the API confirmed. The API corrects each tap by the phone's own
 * clock error (`occurred_at` against `X-Client-Sent-At`), so `at - tappedAt`
 * is that error. Zero with nothing to learn from.
 */
function phoneClockSkewMs(confirmed: Readonly<Record<string, ConfirmedMark>>): number {
  let newest: { at: number; skew: number } | null = null;

  for (const mark of Object.values(confirmed)) {
    if (!mark.tappedAt) continue;

    const at = Date.parse(mark.at);
    const tapped = Date.parse(mark.tappedAt);

    if (Number.isNaN(at) || Number.isNaN(tapped)) continue;
    if (!newest || at > newest.at) newest = { at, skew: at - tapped };
  }

  return newest?.skew ?? 0;
}

/** A queued tap moved onto the API's clock, so it compares with confirmed marks. */
const onApiClock = (tapped: string, skewMs: number): string => {
  const at = Date.parse(tapped);

  return skewMs === 0 || Number.isNaN(at) ? tapped : new Date(at + skewMs).toISOString();
};

/**
 * Each stop's latest mark as the phone knows it: queued taps, and marks the
 * API confirmed. What the app knows of its own marks wins over a cached
 * payload older than them (the later of the two instants is kept).
 *
 * All on the API's clock: a queued tap is shifted by the phone's known clock
 * error, or a phone running slow would rank a tap on B, made after A was
 * confirmed, before A until the tap lands.
 */
function knownMarks(
  confirmed: Readonly<Record<string, ConfirmedMark>>,
  queue: readonly QueuedItem[],
): Map<string, { routeId: string; at: string; queued: boolean }> {
  const marks = new Map<string, { routeId: string; at: string; queued: boolean }>();
  const skewMs = phoneClockSkewMs(confirmed);

  for (const [stopId, mark] of Object.entries(confirmed)) {
    marks.set(stopId, { routeId: mark.routeId, at: mark.at, queued: false });
  }

  for (const item of queue) {
    if (item.kind !== ON_THE_WAY_KIND || !counts(item)) continue;

    const target = onTheWayTarget(item.endpoint);
    if (!target) continue;

    const tapped = onApiClock(
      typeof item.body.occurred_at === "string" ? item.body.occurred_at : item.createdAt,
      skewMs,
    );
    const known = marks.get(target.stopId);

    if (!known || later(known.at, tapped) !== known.at) {
      marks.set(target.stopId, { routeId: target.routeId, at: tapped, queued: true });
    }
  }

  return marks;
}

/** An arrival, proof or occurrence of this delivery still in the queue. */
const queuedFor = (
  queue: readonly QueuedItem[],
  kind: string,
  path: string,
  deliveryId: string,
): QueuedItem[] =>
  queue.filter(
    (item) =>
      item.kind === kind &&
      counts(item) &&
      item.endpoint.startsWith(`/delivery/${path}/${deliveryId}/`),
  );

/**
 * The stop's status once what the phone has queued lands.
 *
 * The API ends "a caminho" when the stop leaves PENDING: an arrival
 * (ARRIVED), a proof, or an occurrence of a type that blocks the delivery.
 * Offline, those taps sit in the queue while the cached stop still says
 * PENDING — reading them here keeps the phone in step with what every other
 * screen will show once they land. A non-blocking occurrence leaves the stop
 * pending on the API, so it does not end anything here either.
 */
function effectiveStopStatus(
  delivery: OnTheWayDelivery,
  queue: readonly QueuedItem[],
  blockingTypeIds: ReadonlySet<string>,
): string | null {
  const stop = stopOf(delivery);
  if (!stop) return null;
  if (stop.status !== "PENDING") return stop.status;

  // The legacy proof, or a delivery registered through its type (decision
  // 14.3; a request that waits for the tower is the rare exception).
  if (
    queuedFor(queue, "delivery-proof", "proof", delivery.id).length > 0 ||
    queuedFor(queue, "delivery-delivered", "report-occurrence", delivery.id).length > 0
  ) {
    return "COMPLETED";
  }

  const blocking = queuedFor(
    queue,
    "delivery-occurrence",
    "report-occurrence",
    delivery.id,
  ).some((item) => blockingTypeIds.has(String(item.body.occurrenceTypeId)));

  if (blocking) return "FAILED";

  if (queuedFor(queue, "delivery-arrival", "arrival", delivery.id).length > 0) {
    return "ARRIVED";
  }

  return "PENDING";
}

interface OnTheWayContext {
  /** The day's cached list: every open stop the phone knows. */
  deliveries: readonly OnTheWayDelivery[];

  /** Marks the API confirmed, by stop id (this driver, this company). */
  confirmed: Readonly<Record<string, ConfirmedMark>>;

  /** This driver's queue. */
  queue: readonly QueuedItem[];

  /** Occurrence types that fail the delivery (`blocks_delivery`). */
  blockingTypeIds?: ReadonlySet<string>;
}

interface OnTheWayView {
  /** "Estou a caminho" may be tapped. */
  offer: boolean;

  /** This stop is the one "a caminho" now. */
  current: boolean;

  /** When the current mark was tapped (or confirmed), if current. */
  since: string | null;

  /** The current mark is still only on the phone. */
  queued: boolean;
}

const NONE: OnTheWayView = { offer: false, current: false, since: null, queued: false };

/**
 * What the delivery screen shows for "a caminho".
 *
 * The button only with the route on the street and the stop untouched
 * (`route.status === "IN_PROGRESS"` and the stop PENDING, the contract's
 * rule) — anything else the API answers with a 409 that means "moot". It is
 * hidden while this stop is already the current one: a second tap is allowed
 * by the API, but it only records another event.
 *
 * Current is decided over the whole route, the API's way: the route's stops
 * in the cached list, plus the stops the phone marked that already left the
 * list (resolved), which still hold the latest mark and so keep an older mark
 * from coming back.
 */
function onTheWayView(delivery: OnTheWayDelivery, context: OnTheWayContext): OnTheWayView {
  const stop = stopOf(delivery);
  if (!stop || stop.route.status !== "IN_PROGRESS") return NONE;

  const blocking = context.blockingTypeIds ?? new Set<string>();
  const marks = knownMarks(context.confirmed, context.queue);

  const routeStops: StopOnTheWayState[] = [];
  const listed = new Set<string>();

  for (const entry of context.deliveries) {
    const entryStop = stopOf(entry);
    if (!entryStop || entryStop.route.id !== stop.route.id) continue;

    listed.add(entryStop.id);
    routeStops.push({
      id: entryStop.id,
      status: effectiveStopStatus(entry, context.queue, blocking) ?? entryStop.status,
      on_the_way_at: later(entryStop.on_the_way_at ?? null, marks.get(entryStop.id)?.at),
    });
  }

  for (const [stopId, mark] of marks) {
    if (mark.routeId !== stop.route.id || listed.has(stopId)) continue;

    // Marked, and no longer in the working list: resolved.
    routeStops.push({ id: stopId, status: "RESOLVED", on_the_way_at: mark.at });
  }

  const currentId = currentOnTheWayStopId(routeStops);
  const status = effectiveStopStatus(delivery, context.queue, blocking);

  if (currentId === stop.id) {
    const mark = marks.get(stop.id);
    const since = later(stop.on_the_way_at ?? null, mark?.at);

    return {
      offer: false,
      current: true,
      since,
      queued: Boolean(mark?.queued) && since === mark?.at,
    };
  }

  return { ...NONE, offer: status === "PENDING" };
}

/**
 * How a refusal ends a queued mark, beyond "failed" (the contract's table).
 *
 * - ROUTE_STOP_NOT_PENDING: the stop was reached or resolved — the mark lost
 *   its point, and nothing is lost by dropping it.
 * - ROUTE_NOT_IN_PROGRESS: moot too, unless the route's own "Iniciar rota" is
 *   still waiting ahead of it in the queue; then the order will fix it.
 *
 * Null leaves the queue's own classification in charge (a reused key or a
 * vanished stop fail visibly, as the contract says).
 */
type OnTheWayRefusalVerdict =
  | { outcome: "settled"; reason: "stop-not-pending" | "route-not-in-progress" }
  | { outcome: "retry" }
  | null;

function onTheWayRefusalVerdict(
  item: QueuedItem,
  code: string | null | undefined,
  queue: readonly QueuedItem[],
): OnTheWayRefusalVerdict {
  if (item.kind !== ON_THE_WAY_KIND || !code) return null;

  if (code === "ROUTE_STOP_NOT_PENDING") {
    return { outcome: "settled", reason: "stop-not-pending" };
  }

  if (code !== "ROUTE_NOT_IN_PROGRESS") return null;

  // The queue on disk holds every driver and company of this phone. Only
  // this driver's departure for this company will ever be sent ahead of the
  // mark; another's (a route reassigned on a shared phone) would hold it in
  // retries forever.
  const mine = queue.filter(
    (other) =>
      other.ownerUserId === item.ownerUserId && other.businessId === item.businessId,
  );

  const target = onTheWayTarget(item.endpoint);
  const position = mine.findIndex((other) => other.id !== undefined && other.id === item.id);

  const departureWaiting =
    target !== null &&
    mine.some(
      (other, index) =>
        other.kind === "delivery-start-route" &&
        (other.status === "pending" || other.status === "parked") &&
        other.endpoint.startsWith(`/route/start-route/${target.routeId}/`) &&
        (position === -1 || index < position),
    );

  return departureWaiting
    ? { outcome: "retry" }
    : { outcome: "settled", reason: "route-not-in-progress" };
}

/** "A caminho desde 14:05", or "salvo no aparelho" while only queued. */
function onTheWayLabel(view: OnTheWayView, formatTime: (iso: string) => string): string {
  const time =
    view.since && !Number.isNaN(Date.parse(view.since))
      ? ` desde ${formatTime(view.since)}`
      : "";

  return view.queued
    ? `A caminho${time} · salvo no aparelho`
    : `A caminho${time}`;
}

/** The `on_the_way_at` the API answered, or null when the answer lacks it. */
function confirmedOnTheWayAt(response: unknown): string | null {
  const data = (response as { data?: { on_the_way_at?: unknown } } | null)?.data;
  const at = data?.on_the_way_at;

  return typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : null;
}

export {
  ON_THE_WAY_KIND,
  confirmedOnTheWayAt,
  currentOnTheWayStopId,
  effectiveStopStatus,
  onTheWayEndpoint,
  onTheWayLabel,
  onTheWayRefusalVerdict,
  onTheWayTarget,
  onTheWayView,
  phoneClockSkewMs,
};

export type {
  ConfirmedMark,
  OnTheWayContext,
  OnTheWayDelivery,
  OnTheWayRefusalVerdict,
  OnTheWayView,
  StopOnTheWayState,
};
