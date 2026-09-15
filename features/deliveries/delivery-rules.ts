/**
 * Delivery rules for the driver app, kept pure so they can be unit-tested.
 *
 * The status machine itself lives in the API; the app only decides what to
 * OFFER for each status — the API remains the judge. Offering exactly what
 * the API accepts is what keeps the offline queue clean: nothing enters the
 * outbox that the server would refuse on the merits.
 */

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
}

interface DeliveriesAccessInput {
  driverId?: string | null;
  enabledModules?: string[] | null;
}

const DELIVERIES_MODULE = "DELIVERIES";

/** The Deliveries entry only exists for a driver with the module on. */
function hasDeliveriesAccess(user: DeliveriesAccessInput | null): boolean {
  if (!user?.driverId) return false;

  return (user.enabledModules ?? []).includes(DELIVERIES_MODULE);
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
  route: {
    id: string;
    code: number;
    name: string | null;
    status: string;
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
 * The route the driver is working, read off the deliveries themselves.
 *
 * Null when none of them is on a route. There is no second request for this:
 * the payload already carries it, and a phone with no signal cannot make one.
 */
function activeRoute<T>(deliveries: T[]): DriverRouteStop["route"] | null {
  for (const delivery of deliveries) {
    const stop = stopOf(delivery as WithStops);

    if (stop) return stop.route;
  }

  return null;
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

/** One tap moves the whole designated block; nothing designated, no button. */
function canStartRoute(
  deliveries: Array<{ status: DeliveryStatus }>,
): boolean {
  return deliveries.some((entry) => entry.status === "PENDING");
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
 * Navigation is a deep-link into the app the driver already trusts. Plain
 * URLs — no API key, no billing: the universal Google Maps link opens the
 * installed app when there is one, and Waze does the same.
 */
function googleMapsUrl(address: DriverDeliveryAddress): string {
  return (
    "https://www.google.com/maps/dir/?api=1&destination=" +
    destinationQuery(address)
  );
}

function wazeUrl(address: DriverDeliveryAddress): string {
  return `https://waze.com/ul?q=${destinationQuery(address)}&navigate=yes`;
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
  activeRoute,
  canStartRoute,
  deliveryActions,
  formatDeliveryAddress,
  googleMapsUrl,
  groupDriverDeliveries,
  hasDeliveriesAccess,
  occurrenceNeedsPhoto,
  sortByRouteOrder,
  stopOf,
  stopPosition,
  wazeUrl,
};

export type { DriverRouteStop };

export type { DeliveriesAccessInput, DeliveryStatus, DriverDeliveryAddress };
