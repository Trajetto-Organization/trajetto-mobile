import type { DeliveryStatus } from "./delivery-rules";
import type { DriverDelivery } from "./types";

/**
 * A delivery of the driver's changed from the panel, while they were working.
 *
 * The problem this solves is quiet, which is what made it bad: the dispatcher
 * cancelled a stop at 10am, the app dropped the row on the next sync, and
 * nothing said anything. With the seven-day offline cache the stale row could
 * sit on the phone for hours first — so the driver either drove to an address
 * that had been called off, or noticed a stop was missing and had no way to
 * find out which.
 *
 * Everything here is pure, because what the driver is told is a product
 * decision, and a product decision that needs a socket to test is one nobody
 * tests.
 */
interface DeliveryOverrideEvent {
  type: "delivery.status_overridden";

  deliveryId: string;
  status: DeliveryStatus;

  /** True when the stop left the list — the urgent case. */
  removedFromWorklist: boolean;
}

interface OverrideNotice {
  title: string;
  message: string;
}

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING: "Pendente",
  IN_TRANSIT: "Em trânsito",
  DELIVERED: "Entregue",
  FAILED: "Insucesso",
  CANCELLED: "Cancelada",
};

/** Whether the payload is one of ours, before anything trusts its fields. */
function isDeliveryOverrideEvent(
  value: unknown,
): value is DeliveryOverrideEvent {
  if (!value || typeof value !== "object") return false;

  const event = value as Partial<DeliveryOverrideEvent>;

  return (
    event.type === "delivery.status_overridden" &&
    typeof event.deliveryId === "string" &&
    typeof event.status === "string" &&
    typeof event.removedFromWorklist === "boolean"
  );
}

/**
 * What to say, using the row the app is ABOUT to lose.
 *
 * Read from the cache before the refetch, because after it the delivery is
 * gone and all the app could say is "uma entrega saiu da sua lista" — which
 * tells a driver with fourteen stops nothing they can act on. The name and the
 * street are what let them place it without opening anything.
 *
 * `null` when the delivery is not in the cache: that means the stop was never
 * on this phone, and announcing a change to something the driver never had
 * would be noise about somebody else's work.
 */
function buildOverrideNotice(
  event: DeliveryOverrideEvent,
  cached: DriverDelivery[],
): OverrideNotice | null {
  const delivery = cached.find((entry) => entry.id === event.deliveryId);

  if (!delivery) return null;

  const address = [delivery.street, delivery.address_number]
    .filter(Boolean)
    .join(", ");

  const where = address ? `${address} — ${delivery.city}` : delivery.city;

  return {
    title: event.removedFromWorklist
      ? "Entrega retirada da sua lista"
      : "Nova entrega na sua lista",

    message: `${delivery.recipient_name} (${where}) agora está ${
      STATUS_LABELS[event.status] ?? event.status
    }.`,
  };
}

export { STATUS_LABELS, buildOverrideNotice, isDeliveryOverrideEvent };
export type { DeliveryOverrideEvent, OverrideNotice };
