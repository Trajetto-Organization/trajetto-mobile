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
 * In the driver's list, every PENDING delivery is designated to them by
 * definition — the API only serves their own. "Designada" is the derived
 * state the whole module speaks.
 */
function groupDriverDeliveries<T extends { status: DeliveryStatus }>(
  deliveries: T[],
): { designated: T[]; inRoute: T[] } {
  return {
    designated: deliveries.filter((entry) => entry.status === "PENDING"),
    inRoute: deliveries.filter((entry) => entry.status === "IN_TRANSIT"),
  };
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
  canStartRoute,
  deliveryActions,
  formatDeliveryAddress,
  googleMapsUrl,
  groupDriverDeliveries,
  hasDeliveriesAccess,
  occurrenceNeedsPhoto,
  wazeUrl,
};

export type { DeliveriesAccessInput, DeliveryStatus, DriverDeliveryAddress };
