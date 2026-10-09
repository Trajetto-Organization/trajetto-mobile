import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The stop's tower state as the two screens draw it: the delivery screen
 * passes the day's occurrence types, the list card does not. Before, the
 * card computed the view without types, so the same queued report of a type
 * the tower must authorize read "Ocorrência salva no aparelho" on the list
 * and "Pedido de autorização salvo no aparelho" on the delivery.
 *
 * The real hook, with its stores and the query cache faked.
 */

let queueItems: unknown[] = [];
const cache = new Map<string, unknown>();

vi.mock("@/store/outbox-store", () => ({
  useOutboxStore: (select: (state: { items: unknown[] }) => unknown) => select({ items: queueItems }),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (select: (state: { user: { businessId: string } }) => unknown) =>
    select({ user: { businessId: "business-1" } }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    getQueryData: (key: unknown[]) => cache.get(JSON.stringify(key)),
  }),
}));

const { useAuthorizationView } = await import("@/features/occurrences/use-authorization-view");

type Delivery = Parameters<typeof useAuthorizationView>[0];
type Types = NonNullable<Parameters<typeof useAuthorizationView>[1]>;

const TYPES = [
  {
    id: "type-ausente",
    name: "Cliente ausente",
    description: null,
    requires_photo: false,
    blocks_delivery: true,
    requires_authorization: true,
  },
] as unknown as Types;

const delivery = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "delivery-1",
    recipient_name: "Mercado Central",
    status: "IN_TRANSIT",
    authorization_request: null,
    ...overrides,
  }) as unknown as Delivery;

const queuedReport = {
  id: "item-1",
  kind: "delivery-occurrence",
  status: "pending",
  businessId: "business-1",
  endpoint: "/delivery/report-occurrence/delivery-1/business/business-1",
  body: { occurrenceTypeId: "type-ausente" },
  createdAt: "2026-09-29T15:20:00.000Z",
};

beforeEach(() => {
  queueItems = [];
  cache.clear();
});

describe("the list card and the delivery screen", () => {
  it("say the same about a queued report the tower must authorize", () => {
    queueItems = [queuedReport];
    cache.set(JSON.stringify(["my-deliveries", "business-1"]), { data: [], occurrence_types: TYPES });

    const onScreen = useAuthorizationView(delivery(), TYPES);
    const onCard = useAuthorizationView(delivery());

    expect(onScreen?.title).toBe("Pedido de autorização salvo no aparelho");
    expect(onCard).toEqual(onScreen);
  });

  it("say the same about an approval that failed the delivery", () => {
    cache.set(JSON.stringify(["my-deliveries", "business-1"]), { data: [], occurrence_types: TYPES });

    const approved = delivery({
      authorization_request: {
        occurrenceId: "occ-1",
        occurrenceTypeId: "type-ausente",
        occurrenceTypeName: "Cliente ausente",
        status: "APPROVED",
        note: null,
        decidedAt: "2026-09-29T15:30:00.000Z",
        requestedAt: "2026-09-29T15:02:11.000Z",
      },
    });

    expect(useAuthorizationView(approved)).toEqual(useAuthorizationView(approved, TYPES));
    expect(useAuthorizationView(approved)?.nextStep).toBe(
      "Entrega registrada como Insucesso. Siga para a próxima parada.",
    );
  });

  it("without a cached day the card still shows the queue, in the plain words", () => {
    queueItems = [queuedReport];

    expect(useAuthorizationView(delivery())?.title).toBe("Ocorrência salva no aparelho");
  });

  it("the badge and the card both draw through this hook", () => {
    const component = readFileSync(
      resolve(__dirname, "../../components/screens/occurrences/occurrence-authorization-card.tsx"),
      "utf8",
    );

    expect(component).toContain(
      'import { useAuthorizationView } from "@/features/occurrences/use-authorization-view";',
    );
    expect(component).toContain("const view = useAuthorizationView(delivery, occurrenceTypes);");
    expect(component).toContain("const view = useAuthorizationView(delivery);");
    expect(component).not.toMatch(/function useAuthorizationView/);
  });
});
