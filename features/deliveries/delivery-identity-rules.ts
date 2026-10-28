import { onTheWayTarget } from "./on-the-way-rules";

/**
 * How a delivery is told apart on a screen: its identifiers and its kind.
 *
 * Pure and import-free (on-the-way-rules is too), like `delivery-rules`. The
 * product rule is that every list item shows its canonical identifier: the
 * order code AND the invoice (NF-e) the driver holds in hand, since the
 * recipient's name alone repeats across a day of stops (two drops at the same
 * supermarket, the same customer twice).
 */

interface DeliveryIdentifiers {
  code?: string | null;
  invoice_number?: string | null;
}

/** A value worth printing: a blank or whitespace-only field reads as absent. */
const present = (value: string | null | undefined): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";

  return trimmed ? trimmed : null;
};

/**
 * "Pedido: 4815 · NF-e 162342" (or just one of them), in the delivery
 * screen's own wording: "Pedido:" in its header, "NF-e" in its cargo card.
 * Null when the delivery has neither, so the screen draws no empty line.
 */
function deliveryIdentifiersLabel(
  delivery: DeliveryIdentifiers,
): string | null {
  const code = present(delivery.code);
  const invoice = present(delivery.invoice_number);

  const parts = [
    code ? `Pedido: ${code}` : null,
    invoice ? `NF-e ${invoice}` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * What a stop is, as the API's `Delivery.kind` says. Optional on the
 * payload: an API before the field, and the seven days of cached lists
 * written by it, have no key at all, and those are deliveries.
 */
type DeliveryKind = "DELIVERY" | "PICKUP" | "SERVICE_ORDER";

/** The kinds that wear a badge: a plain delivery wears none. */
type BadgedDeliveryKind = Exclude<DeliveryKind, "DELIVERY">;

/**
 * The badge a kind wears on the card and the delivery screen. "Coleta" is
 * the web's label (the route board's).
 */
const DELIVERY_KIND_BADGE: Readonly<Record<BadgedDeliveryKind, string>> = {
  PICKUP: "Coleta",
  SERVICE_ORDER: "Ordem de serviço",
};

/**
 * The badge for this kind, or null. Absent, DELIVERY, or a value this build
 * does not know (a newer API's) all read as a plain delivery: no badge,
 * rather than a raw enum on the screen.
 */
function deliveryKindBadge(
  kind: unknown,
): { kind: BadgedDeliveryKind; label: string } | null {
  return kind === "PICKUP" || kind === "SERVICE_ORDER"
    ? { kind, label: DELIVERY_KIND_BADGE[kind] }
    : null;
}

/**
 * Delivery id → order code, for the deliveries that have one. The chat's
 * messages name a delivery by id and recipient only (the API's chat payload
 * carries no code); the cached day supplies the code, and a delivery it no
 * longer holds simply shows none.
 */
function deliveryCodeIndex(
  deliveries: ReadonlyArray<{ id: string; code?: string | null }>,
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();

  for (const delivery of deliveries) {
    const code = present(delivery.code);
    if (code) index.set(delivery.id, code);
  }

  return index;
}

/** The delivery steps whose endpoint names the delivery itself. */
const DELIVERY_STEP_ENDPOINT =
  /^\/delivery\/(?:arrival|proof|report-occurrence)\/([^/]+)\/business\/[^/]+$/;

interface StepDelivery extends DeliveryIdentifiers {
  id: string;
  stops?: ReadonlyArray<{ id: string }> | null;
}

/**
 * The delivery a queued step is about, found in the phone's cached list.
 *
 * The outbox item keeps only its URL and a label ("Entrega para Fulano"), so
 * the identifiers come from the cached delivery: by id for an arrival, proof
 * or occurrence, by stop for "a caminho". Null when the URL names no delivery
 * (a departure, a pause) or the delivery is no longer in the cache: the
 * screen then shows what it had, never a guessed identifier.
 */
function deliveryOfQueuedStep<T extends StepDelivery>(
  endpoint: string,
  deliveries: ReadonlyArray<T>,
): T | null {
  const step = DELIVERY_STEP_ENDPOINT.exec(endpoint);

  if (step)
    return deliveries.find((delivery) => delivery.id === step[1]) ?? null;

  const onTheWay = onTheWayTarget(endpoint);

  if (!onTheWay) return null;

  return (
    deliveries.find((delivery) =>
      (delivery.stops ?? []).some((stop) => stop.id === onTheWay.stopId),
    ) ?? null
  );
}

export {
  DELIVERY_KIND_BADGE,
  deliveryCodeIndex,
  deliveryIdentifiersLabel,
  deliveryKindBadge,
  deliveryOfQueuedStep,
};
export type { BadgedDeliveryKind, DeliveryIdentifiers, DeliveryKind };
