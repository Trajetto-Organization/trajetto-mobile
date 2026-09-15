import { describe, expect, it } from "vitest";

import {
  buildOverrideNotice,
  isDeliveryOverrideEvent,
  type DeliveryOverrideEvent,
} from "@/features/deliveries/delivery-override-rules";

import type { DriverDelivery } from "@/features/deliveries/types";

/**
 * What the driver is told when the panel changes a stop under them.
 *
 * Until this existed the app said nothing: the dispatcher cancelled a delivery
 * at 10am, the row disappeared on the next sync, and the driver either drove
 * to a called-off address or noticed one was missing and could not find out
 * which. The seven-day offline cache made it worse rather than better — the
 * stale row could sit on the phone for hours before it vanished.
 *
 * The rule that makes the message useful is the order: the notice is built
 * from the CACHED row, before the refetch removes it. After the refetch the
 * app could only say "uma entrega saiu da sua lista", which tells somebody
 * with fourteen stops nothing they can act on.
 */
function delivery(overrides: Partial<DriverDelivery> = {}): DriverDelivery {
  return {
    id: "delivery-1",
    status: "PENDING",
    recipient_name: "Padaria Central",
    street: "Praça da Sé",
    address_number: "100",
    city: "São Paulo",
    uf: "SP",
    ...overrides,
  } as DriverDelivery;
}

function event(
  overrides: Partial<DeliveryOverrideEvent> = {},
): DeliveryOverrideEvent {
  return {
    type: "delivery.status_overridden",
    deliveryId: "delivery-1",
    status: "CANCELLED",
    removedFromWorklist: true,
    ...overrides,
  };
}

describe("trusting the payload", () => {
  it("accepts the event the server actually sends", () => {
    expect(isDeliveryOverrideEvent(event())).toBe(true);
  });

  it("refuses anything else on the same channel", () => {
    // The socket carries other frames, and a hook that trusted the shape would
    // read undefined fields into a toast.
    for (const value of [
      null,
      undefined,
      "delivery.status_overridden",
      {},
      { type: "chatMessage", deliveryId: "delivery-1" },
      { type: "delivery.status_overridden", deliveryId: 7 },
      {
        type: "delivery.status_overridden",
        deliveryId: "delivery-1",
        status: "CANCELLED",
      },
    ]) {
      expect(isDeliveryOverrideEvent(value), JSON.stringify(value)).toBe(false);
    }
  });
});

describe("naming the stop that changed", () => {
  it("uses the row still in the cache", () => {
    const notice = buildOverrideNotice(event(), [delivery()]);

    expect(notice).not.toBeNull();

    expect(notice!.title).toContain("retirada");
    expect(notice!.message).toContain("Padaria Central");

    expect(notice!.message).toContain("Praça da Sé, 100");
    expect(notice!.message).toContain("São Paulo");

    expect(notice!.message).toContain("Cancelada");
  });

  it("reads differently for a stop gained", () => {
    const notice = buildOverrideNotice(
      event({ status: "PENDING", removedFromWorklist: false }),
      [delivery({ status: "FAILED" })],
    );

    expect(notice!.title).toContain("Nova entrega");
    expect(notice!.message).toContain("Pendente");
  });

  it("falls back to the city when there is no street number", () => {
    const notice = buildOverrideNotice(event(), [
      delivery({ address_number: null }),
    ]);

    expect(notice!.message).toContain("Praça da Sé — São Paulo");
  });

  it("says nothing about a delivery this phone never had", () => {
    // Announcing a change to a stop the driver never carried is noise about
    // somebody else's work.
    expect(buildOverrideNotice(event(), [])).toBeNull();

    expect(
      buildOverrideNotice(event({ deliveryId: "outra" }), [delivery()]),
    ).toBeNull();
  });

  it("prints a status it does not know rather than nothing", () => {
    // A status added on the server before the app ships is a real sequence,
    // and a message with a blank where the status goes is worse than a raw
    // word the driver can still ask about.
    const notice = buildOverrideNotice(
      event({ status: "RETURNED" as never }),
      [delivery()],
    );

    expect(notice!.message).toContain("RETURNED");
  });
});
