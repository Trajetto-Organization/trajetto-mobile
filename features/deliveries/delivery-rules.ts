/**
 * Delivery rules for the driver app, kept pure so they can be unit-tested.
 *
 * The status machine itself lives in the API; the app only decides what to
 * OFFER for each status — the API remains the judge. Offering exactly what
 * the API accepts is what keeps the offline queue clean: nothing enters the
 * outbox that the server would refuse on the merits.
 */

import {
  DELIVERIES_MODULE,
  hasDeliveriesAccess,
} from "@/features/access/module-rules";

type DeliveryStatus =
  | "PENDING"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED";

interface DriverDeliveryAddress {
  street: string;
  address_number?: string | null;
  neighborhood?: string | null;
  city: string;
  uf: string;
  cep?: string | null;

  /**
   * Where the address is, when the dispatcher pinned it or it was geocoded
   * (decision 14.7). Optional: cached payloads and older APIs have none.
   */
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * The input `hasDeliveriesAccess` reads. The rule itself lives once, in
 * `module-rules`, next to the fleet's (decision 4.2 — one source); it is
 * re-exported here because the delivery screens already import it from here.
 */
interface DeliveriesAccessInput {
  driverId?: string | null;
  enabledModules?: string[] | null;
}

/**
 * The stop this delivery occupies on a route, when it is on one.
 *
 * At most one: the API's partial unique index allows a delivery exactly one
 * open stop, so `stops[0]` is the whole story. A delivery assigned in a batch
 * — without a route — has none, which is the ordinary case for operations
 * that never adopted routes.
 */
interface DriverRouteStop {
  id: string;
  sequence: number;
  status: string;

  /**
   * When the driver arrived, once the stop is ARRIVED. Optional: payloads
   * cached before the API served it have no key, and the screen then says
   * "Chegada registrada" without the time.
   */
  arrived_at?: string | null;

  /**
   * The stop's latest "a caminho" mark (decision 6.4), once the API serves
   * it in this payload (contract: not yet). Until then the app knows its own
   * marks from the queue and on-the-way-store.
   */
  on_the_way_at?: string | null;

  route: {
    id: string;
    code: number;
    name: string | null;
    status: string;

    /**
     * The route's destination and planned window (decision 6.5), once the
     * API serves them in this payload. Optional for the same reason as
     * `arrived_at`: cached payloads, and API versions, without the keys.
     */
    destination?: string | null;
    planned_departure_at?: string | null;
    planned_arrival_at?: string | null;

    /** The route's day, date-only at UTC midnight (decision 14.4). */
    scheduled_date?: string | null;
  };
}

/**
 * `stops` is optional on purpose, and the reason is a phone.
 *
 * The API always sends it now — an empty array when the delivery is on no
 * route. But the app renders from a cache that holds up to seven days of
 * payloads, and the ones written before this field existed have no key at
 * all. A required field here would make those rows a type lie and, worse,
 * `stops[0]` on them a crash on a screen a driver is using in the street.
 */
interface WithStops {
  stops?: DriverRouteStop[] | null;
}

function stopOf(delivery: WithStops): DriverRouteStop | null {
  return delivery.stops?.[0] ?? null;
}

/**
 * The order the dispatcher chose, which until now the driver could not see.
 *
 * Sorting happens HERE and not on the server, and that is not an accident:
 * this list is rendered from the seven-day offline cache, where whatever order
 * the server sent is long gone. The sequence travels with each delivery and
 * the app is what puts the street in order.
 *
 * Deliveries with no stop keep the order they arrived in, after the routed
 * ones — they are the batch-assigned work, which has no street order to
 * respect, and putting them first would bury the route the driver is actually
 * running.
 */
function sortByRouteOrder<T>(deliveries: T[]): T[] {
  return [...deliveries].sort((left, right) => {
    const leftStop = stopOf(left as WithStops);
    const rightStop = stopOf(right as WithStops);

    if (leftStop && rightStop) return leftStop.sequence - rightStop.sequence;

    if (leftStop) return -1;
    if (rightStop) return 1;

    return 0;
  });
}

/**
 * In the driver's list, every PENDING delivery is designated to them by
 * definition — the API only serves their own. "Designada" is the derived
 * state the whole module speaks.
 *
 * Both groups come back in the dispatcher's order when there is one.
 */
function groupDriverDeliveries<T extends { status: DeliveryStatus }>(
  deliveries: T[],
): { designated: T[]; inRoute: T[] } {
  return {
    designated: sortByRouteOrder(
      deliveries.filter((entry) => entry.status === "PENDING"),
    ),
    inRoute: sortByRouteOrder(
      deliveries.filter((entry) => entry.status === "IN_TRANSIT"),
    ),
  };
}

/**
 * Which position this address is, in the order the driver follows.
 *
 * The POSITION, not the stored sequence: sequences are spaced by ten so the
 * dispatcher can drop a stop between two others cheaply, and telling a driver
 * they are at address "20" of a six-stop route would be nonsense.
 */
function stopPosition<T>(ordered: T[], delivery: T): number | null {
  const stop = stopOf(delivery as WithStops);

  if (!stop) return null;

  const index = ordered.findIndex(
    (entry) => stopOf(entry as WithStops)?.id === stop.id,
  );

  return index === -1 ? null : index + 1;
}

type DriverRoute = DriverRouteStop["route"];

/**
 * What "Iniciar rota" does for one group of designated deliveries.
 *
 * `routeId: null` is the whole-day departure of the work assigned before
 * assignments created routes (`/delivery/start-route`), which moves only the
 * loose deliveries.
 */
interface StartRouteTarget {
  routeId: string | null;
  routeCode: number | null;
  count: number;
}

/** One block of the day's list: a route (or the loose work), and its state. */
interface DeliverySection<T> {
  key: string;
  group: "in-route" | "designated";

  /** Null for deliveries on no route. */
  route: DriverRoute | null;

  deliveries: T[];

  /** Only designated sections of a released route (or loose work) start. */
  start: StartRouteTarget | null;

  /** Why a designated section has no button, in words for the driver. */
  notice: string | null;
}

const LOOSE_SECTION_KEY = "loose";

/**
 * Why a designated route cannot be started from the phone.
 *
 * The API moves only RELEASED → IN_PROGRESS. A planned route is the
 * dispatcher's draft; one already running took its deliveries along when it
 * left, so designated work on it is the dispatcher's to sort out — and
 * "starting" it again would answer success and move nothing (MOB-04).
 */
function startNotice(route: DriverRoute): string | null {
  if (route.status === "PLANNED") {
    return "Rota ainda não liberada pelo despachante.";
  }

  if (route.status === "IN_PROGRESS") {
    return "Esta rota já está em andamento. Fale com o despachante para incluir estas entregas.";
  }

  return null;
}

/**
 * Why a released route cannot leave while another of the driver's routes is
 * on the street. The API refuses that departure (409 ROUTE_DRIVER_BUSY, one
 * route per driver on the street); the button would only queue a refusal.
 * Same sentence as the API's, so the pending screen and the list agree.
 */
function busyNotice(running: DriverRoute): string {
  return `Você já está com a Rota ${running.code} em andamento. Conclua essa rota (ou peça ao despachante para cancelá-la) antes de iniciar outra.`;
}

/** The driver's route on the street, if the day's list shows one. */
function runningRouteOf<T>(deliveries: T[]): DriverRoute | null {
  for (const delivery of deliveries) {
    const route = stopOf(delivery as WithStops)?.route;

    if (route?.status === "IN_PROGRESS") return route;
  }

  return null;
}

function sectionsOf<T>(
  deliveries: T[],
  group: DeliverySection<T>["group"],
  running: DriverRoute | null = null,
): DeliverySection<T>[] {
  const byRoute = new Map<string, { route: DriverRoute | null; items: T[] }>();

  for (const delivery of deliveries) {
    const route = stopOf(delivery as WithStops)?.route ?? null;
    const key = route?.id ?? LOOSE_SECTION_KEY;

    const bucket = byRoute.get(key) ?? { route, items: [] };
    bucket.items.push(delivery);
    byRoute.set(key, bucket);
  }

  // Oldest route first (codes grow with time), the loose work last: it has no
  // street order and must not bury a route the driver is running.
  const ordered = [...byRoute.entries()].sort(([, left], [, right]) => {
    if (!left.route) return 1;
    if (!right.route) return -1;

    return left.route.code - right.route.code;
  });

  return ordered.map(([key, { route, items }]) => {
    const sorted = sortByRouteOrder(items);

    // A released route waits for the running one to end. The loose work
    // keeps its button: its departure (`/delivery/start-route`) is not
    // refused while a route runs.
    const blockedBy =
      group === "designated" &&
      route?.status === "RELEASED" &&
      running &&
      running.id !== route.id
        ? running
        : null;

    const startable =
      group === "designated" &&
      !blockedBy &&
      (!route || route.status === "RELEASED");

    let notice: string | null = null;

    if (blockedBy) notice = busyNotice(blockedBy);
    else if (group === "designated" && route) notice = startNotice(route);

    return {
      key: `${group}:${key}`,
      group,
      route,
      deliveries: sorted,
      start: startable
        ? {
            routeId: route?.id ?? null,
            routeCode: route?.code ?? null,
            count: sorted.length,
          }
        : null,
      notice,
    };
  });
}

/**
 * The day's list, one section per route.
 *
 * Each assignment creates its own route, so a driver already on the street
 * can be handed a second one. The old screen read "the" route off the first
 * delivery it found — the running one — and its single "Iniciar rota" posted
 * to it: the API answered the resend as success, the phone said "Rota
 * iniciada!", and the new deliveries stayed Designadas with nothing the
 * driver could do (MOB-04). Now every route is its own section with its own
 * button, and a button only exists where pressing it moves something — which
 * rules out a second route while one is on the street (FLEET-ASSIGN-3).
 */
function deliverySections<T extends { status: DeliveryStatus }>(
  inRoute: T[],
  designated: T[],
): DeliverySection<T>[] {
  const running = runningRouteOf(inRoute) ?? runningRouteOf(designated);

  return [
    ...sectionsOf(inRoute, "in-route"),
    ...sectionsOf(designated, "designated", running),
  ];
}

/** The route the header names, when the day has exactly one. */
function headerRoute<T>(sections: DeliverySection<T>[]): DriverRoute | null {
  const routes = new Map<string, DriverRoute>();

  for (const section of sections) {
    if (section.route) routes.set(section.route.id, section.route);
  }

  return routes.size === 1 ? [...routes.values()][0] : null;
}

/** "Rota 42 · Zona Sul", or "Rota 42" when the route has no name. */
function routeLabel(route: DriverRoute): string {
  return route.name ? `Rota ${route.code} · ${route.name}` : `Rota ${route.code}`;
}

/** What the section header says: "Designadas · Rota 42 (3)". */
function sectionTitle<T>(section: DeliverySection<T>): string {
  const group = section.group === "in-route" ? "Em rota" : "Designadas";
  const where = section.route ? routeLabel(section.route) : "sem rota";

  return `${group} · ${where} (${section.deliveries.length})`;
}

const isInstant = (value: string | null | undefined): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

/**
 * "Destino: CD Campinas · Saída prevista 07:30 · Retorno previsto 18:00",
 * with whatever of it the route has; null when it has none. The times are
 * instants, shown on the phone's clock (decision 1.4).
 */
function routePlan(
  route: DriverRoute,
  formatTime: (iso: string) => string = formatClock,
): string | null {
  const parts: string[] = [];

  const destination = route.destination?.trim();
  if (destination) parts.push(`Destino: ${destination}`);

  if (isInstant(route.planned_departure_at)) {
    parts.push(`Saída prevista ${formatTime(route.planned_departure_at)}`);
  }

  if (isInstant(route.planned_arrival_at)) {
    parts.push(`Retorno previsto ${formatTime(route.planned_arrival_at)}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The button of one section: "Iniciar rota 42 (3 entregas)". */
function startRouteLabel(target: StartRouteTarget): string {
  const count = `${target.count} entrega${target.count > 1 ? "s" : ""}`;

  return target.routeCode !== null
    ? `Iniciar rota ${target.routeCode} (${count})`
    : `Iniciar entregas sem rota (${count})`;
}

/**
 * What the driver may do on one delivery. Everything operational happens in
 * route: arriving, proving and reporting all wait for IN_TRANSIT — the API
 * refuses them earlier, so the app does not offer them earlier.
 */
function deliveryActions(status: DeliveryStatus): {
  canArrive: boolean;
  canProve: boolean;
  canReportOccurrence: boolean;
} {
  const inRoute = status === "IN_TRANSIT";

  return {
    canArrive: inRoute,
    canProve: inRoute,
    canReportOccurrence: inRoute,
  };
}

/** An outbox item, as far as the arrival rule needs to read it. */
interface QueuedSubmission {
  kind: string;
  status: string;
  endpoint: string;
  body: Record<string, unknown>;
  createdAt: string;
}

/**
 * When an arrival for this delivery is waiting in the queue, the moment the
 * driver tapped it. A failed item does not count: the driver has to decide
 * about it, and "Cheguei" must stay available to record the arrival again.
 */
function queuedArrivalAt(
  items: readonly QueuedSubmission[],
  deliveryId: string,
): string | null {
  const prefix = `/delivery/arrival/${deliveryId}/`;

  const item = items.find(
    (entry) =>
      entry.kind === "delivery-arrival" &&
      entry.status !== "failed" &&
      entry.endpoint.startsWith(prefix),
  );

  if (!item) return null;

  const tapped = item.body.occurred_at;

  return typeof tapped === "string" ? tapped : item.createdAt;
}

interface ArrivalState {
  arrived: boolean;

  /** When, if known. */
  at: string | null;

  /** Recorded on the phone, not yet on the server. */
  queued: boolean;
}

/**
 * Whether the driver already said "Cheguei" at this stop.
 *
 * The API accepts more than one arrival — a redelivery arrives again — so a
 * second tap used to write a second ARRIVAL event for the same visit
 * (MOB-19). The stop's own status says it once the server has it; the queue
 * says it while the phone is offline.
 */
function arrivalState(
  delivery: WithStops,
  queuedAt: string | null,
): ArrivalState {
  const stop = stopOf(delivery);

  if (stop?.status === "ARRIVED") {
    return { arrived: true, at: stop.arrived_at ?? null, queued: false };
  }

  if (queuedAt) return { arrived: true, at: queuedAt, queued: true };

  return { arrived: false, at: null, queued: false };
}

const formatClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

/** "Chegada registrada às 14:05", or without the time when it is unknown. */
function arrivalLabel(
  state: ArrivalState,
  formatTime: (iso: string) => string = formatClock,
): string {
  const time =
    state.at && !Number.isNaN(Date.parse(state.at))
      ? ` às ${formatTime(state.at)}`
      : "";

  return state.queued
    ? `Chegada salva no aparelho${time}`
    : `Chegada registrada${time}`;
}

/**
 * The list with this delivery's stop marked ARRIVED, right after the tap.
 *
 * The refetch that follows a sent arrival can fail on a flaky network, and
 * until it lands the cached stop still says PENDING — which put "Cheguei"
 * back on screen for a second tap.
 */
function withStopArrived<T extends { id: string } & WithStops>(
  deliveries: T[],
  deliveryId: string,
  arrivedAt: string,
): T[] {
  return deliveries.map((delivery) => {
    const stop = stopOf(delivery);

    if (delivery.id !== deliveryId || !stop || stop.status !== "PENDING") {
      return delivery;
    }

    return {
      ...delivery,
      stops: [{ ...stop, status: "ARRIVED", arrived_at: arrivedAt }],
    };
  });
}

/** The switch's promise: a photo-required type refuses a bare report. */
function occurrenceNeedsPhoto(
  occurrenceType: { requires_photo?: boolean | null },
  photoCount: number,
): boolean {
  return occurrenceType.requires_photo === true && photoCount === 0;
}

function formatDeliveryAddress(address: DriverDeliveryAddress): string {
  const line = [
    address.street,
    address.address_number ? `, ${address.address_number}` : "",
    address.neighborhood ? ` — ${address.neighborhood}` : "",
  ].join("");

  return `${line} · ${address.city}/${address.uf}`;
}

const destinationQuery = (address: DriverDeliveryAddress): string =>
  encodeURIComponent(
    `${address.street}, ${address.address_number ?? ""}, ` +
      `${address.city} - ${address.uf}` +
      (address.cep ? `, ${address.cep}` : ""),
  );

/**
 * The delivery's point as "lat,lng", or null when it has no usable one. The
 * point beats the written address (route design §6.6): it is what the
 * dispatcher placed on the map, while the text may not geocode at all.
 */
function pointQuery(address: DriverDeliveryAddress): string | null {
  const { latitude, longitude } = address;

  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return encodeURIComponent(`${latitude},${longitude}`);
}

/**
 * Navigation is a deep-link into the app the driver already trusts. Plain
 * URLs — no API key, no billing: the universal Google Maps link opens the
 * installed app when there is one, and Waze does the same.
 */
function googleMapsUrl(address: DriverDeliveryAddress): string {
  return (
    "https://www.google.com/maps/dir/?api=1&destination=" +
    (pointQuery(address) ?? destinationQuery(address))
  );
}

function wazeUrl(address: DriverDeliveryAddress): string {
  const point = pointQuery(address);

  return point
    ? `https://waze.com/ul?ll=${point}&navigate=yes`
    : `https://waze.com/ul?q=${destinationQuery(address)}&navigate=yes`;
}

/** PENDING reads as "Designada" here: the driver only ever sees their own. */
const DRIVER_DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING: "Designada",
  IN_TRANSIT: "Em rota",
  DELIVERED: "Entregue",
  FAILED: "Insucesso",
  CANCELLED: "Cancelada",
};

export {
  DELIVERIES_MODULE,
  DRIVER_DELIVERY_STATUS_LABELS,
  arrivalLabel,
  arrivalState,
  deliveryActions,
  deliverySections,
  formatClock,
  formatDeliveryAddress,
  googleMapsUrl,
  groupDriverDeliveries,
  hasDeliveriesAccess,
  headerRoute,
  occurrenceNeedsPhoto,
  queuedArrivalAt,
  routeLabel,
  routePlan,
  sectionTitle,
  sortByRouteOrder,
  startRouteLabel,
  stopOf,
  stopPosition,
  wazeUrl,
  withStopArrived,
};

export type {
  ArrivalState,
  DeliverySection,
  DriverRoute,
  DriverRouteStop,
  QueuedSubmission,
  StartRouteTarget,
};

export type { DeliveriesAccessInput, DeliveryStatus, DriverDeliveryAddress };
