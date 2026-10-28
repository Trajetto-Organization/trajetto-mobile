import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  DELIVERY_KIND_BADGE,
  deliveryCodeIndex,
  deliveryIdentifiersLabel,
  deliveryKindBadge,
  deliveryOfQueuedStep,
} from "@/features/deliveries/delivery-identity-rules";
import { onTheWayEndpoint } from "@/features/deliveries/on-the-way-rules";

/**
 * Every list item shows its canonical identifier (product rule): the order
 * code and the NF-e on the day's card, the queued step on the pending screen
 * and the chat's delivery chip; and the kind of stop (decision: SERVICE_ORDER
 * joins DELIVERY and PICKUP on `Delivery.kind`) as a badge. The recipient's
 * name alone repeats across a day of stops.
 *
 * The rules are pure; the card and the badge are called directly and their
 * tree read, as in delivery-card-on-the-way.test.ts.
 */
vi.hoisted(() => {
  (globalThis as { React?: unknown }).React = {
    createElement: (
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ) => ({ type, props: { ...(props ?? {}), children } }),
  };
});

vi.mock("react-native", () => ({
  Text: "Text",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("@/hooks/use-theme", async () => {
  const { themeColors } = await import("@/utils/theme-rules");
  return { useThemeColors: () => themeColors("light") };
});
vi.mock(
  "@/components/screens/occurrences/occurrence-authorization-card",
  () => ({
    OccurrenceAuthorizationBadge: "OccurrenceAuthorizationBadge",
  }),
);

const ROOT = resolve(__dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

type Element = { type: unknown; props: Record<string, unknown> };
type Component = (props: Record<string, unknown>) => unknown;

let DeliveryCard: Component;
let DeliveryKindBadge: Component;

beforeAll(async () => {
  ({ DeliveryCard } =
    (await import("@/components/screens/deliveries/delivery-card")) as unknown as {
      DeliveryCard: Component;
    });
  ({ DeliveryKindBadge } =
    (await import("@/components/screens/deliveries/delivery-kind-badge")) as unknown as {
      DeliveryKindBadge: Component;
    });
});

function flatten(node: unknown, found: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, found));
    return found;
  }
  if (!node || typeof node !== "object") return found;

  const element = node as Element;
  found.push(element);
  flatten(element.props?.children, found);
  return found;
}

const texts = (tree: unknown): string[] =>
  flatten(tree)
    .filter((element) => element.type === "Text")
    .map((element) =>
      ([] as unknown[])
        .concat(element.props.children as unknown[])
        .flat(Infinity)
        .filter((part) => typeof part === "string" || typeof part === "number")
        .join(""),
    );

describe("a delivery's identifiers", () => {
  it("shows the order code and the NF-e, in the delivery screen's wording", () => {
    expect(
      deliveryIdentifiersLabel({ code: "4815", invoice_number: "162342" }),
    ).toBe("Pedido: 4815 · NF-e 162342");
  });

  it("shows whichever one it has", () => {
    expect(deliveryIdentifiersLabel({ code: "4815" })).toBe("Pedido: 4815");
    expect(
      deliveryIdentifiersLabel({ code: null, invoice_number: "162342" }),
    ).toBe("NF-e 162342");
  });

  it("draws no line for a delivery with neither (blank counts as absent)", () => {
    expect(deliveryIdentifiersLabel({})).toBeNull();
    expect(
      deliveryIdentifiersLabel({ code: null, invoice_number: null }),
    ).toBeNull();
    expect(
      deliveryIdentifiersLabel({ code: "  ", invoice_number: "" }),
    ).toBeNull();
  });

  it("trims what the shipper's data padded", () => {
    expect(
      deliveryIdentifiersLabel({ code: " 4815 ", invoice_number: " 162342\n" }),
    ).toBe("Pedido: 4815 · NF-e 162342");
  });

  it("indexes the codes the chat chip needs, skipping deliveries without one", () => {
    const index = deliveryCodeIndex([
      { id: "a", code: "4815" },
      { id: "b", code: null },
      { id: "c", code: "   " },
      { id: "d" },
      { id: "e", code: " 16 " },
    ]);

    expect([...index.entries()]).toEqual([
      ["a", "4815"],
      ["e", "16"],
    ]);
  });
});

describe("a delivery's kind", () => {
  it("badges a service order and a pickup with the web's labels", () => {
    expect(deliveryKindBadge("SERVICE_ORDER")).toEqual({
      kind: "SERVICE_ORDER",
      label: "Ordem de serviço",
    });
    expect(deliveryKindBadge("PICKUP")).toEqual({
      kind: "PICKUP",
      label: "Coleta",
    });
    expect(DELIVERY_KIND_BADGE).toEqual({
      PICKUP: "Coleta",
      SERVICE_ORDER: "Ordem de serviço",
    });
  });

  it("badges nothing for a plain delivery", () => {
    expect(deliveryKindBadge("DELIVERY")).toBeNull();
  });

  it("reads an older API's payload, and the cache it wrote, as a delivery", () => {
    // No `kind` key at all: up to seven days of cached lists look like this.
    expect(deliveryKindBadge(undefined)).toBeNull();
    expect(deliveryKindBadge(null)).toBeNull();
  });

  it("never shows a value this build does not know as a raw enum", () => {
    expect(deliveryKindBadge("RETURN")).toBeNull();
    expect(deliveryKindBadge("service_order")).toBeNull();
    expect(deliveryKindBadge(1)).toBeNull();
  });
});

describe("the delivery a queued step is about", () => {
  const deliveries = [
    { id: "d1", code: "4815", invoice_number: "162342", stops: [{ id: "s1" }] },
    { id: "d2", code: "16", stops: null },
    { id: "d3", code: "23" },
  ];

  it.each([
    ["arrival", "/delivery/arrival/d1/business/b1"],
    ["proof", "/delivery/proof/d1/business/b1"],
    [
      "occurrence or delivered report",
      "/delivery/report-occurrence/d1/business/b1",
    ],
  ])("finds it by id for a queued %s", (_kind, endpoint) => {
    expect(deliveryOfQueuedStep(endpoint, deliveries)?.id).toBe("d1");
  });

  it("finds it by its stop for a queued 'a caminho'", () => {
    expect(
      deliveryOfQueuedStep(onTheWayEndpoint("s1", "r1", "b1"), deliveries)?.id,
    ).toBe("d1");
    // A delivery off-route, or from a cache written before `stops`, has none.
    expect(
      deliveryOfQueuedStep(onTheWayEndpoint("s9", "r1", "b1"), deliveries),
    ).toBeNull();
  });

  it("finds nothing for a step about no delivery, or one the cache no longer holds", () => {
    expect(
      deliveryOfQueuedStep("/route/start-route/r1/business/b1", deliveries),
    ).toBeNull();
    expect(
      deliveryOfQueuedStep("/driver-pause/start/b1", deliveries),
    ).toBeNull();
    expect(deliveryOfQueuedStep("/fuel/create/b1", deliveries)).toBeNull();
    expect(
      deliveryOfQueuedStep("/delivery/arrival/gone/business/b1", deliveries),
    ).toBeNull();
    expect(
      deliveryOfQueuedStep(
        "/delivery/arrival/d1/business/b1/extra",
        deliveries,
      ),
    ).toBeNull();
    expect(
      deliveryOfQueuedStep("/delivery/arrival/d1/business/b1", []),
    ).toBeNull();
  });
});

const delivery = {
  id: "0192b1c4-0000-4000-8000-000000000001",
  code: "PED-1",
  invoice_number: "162342",
  recipient_name: "Maria Souza",
  status: "PENDING",
  street: "Rua A",
  city: "São Paulo",
  uf: "SP",
};

describe("the day's card", () => {
  it("shows the order code and the NF-e on one line", () => {
    const tree = DeliveryCard({ delivery, onPress: () => undefined });

    expect(texts(tree)).toContain("Pedido: PED-1 · NF-e 162342");
  });

  it("carries the kind badge, fed by the delivery's kind", () => {
    const tree = DeliveryCard({
      delivery: { ...delivery, kind: "SERVICE_ORDER" },
      onPress: () => undefined,
    });
    const badge = flatten(tree).find(
      (element) => element.type === DeliveryKindBadge,
    );

    expect(badge?.props.kind).toBe("SERVICE_ORDER");
  });
});

describe("the kind badge", () => {
  it("reads 'Ordem de serviço' and 'Coleta'", () => {
    expect(texts(DeliveryKindBadge({ kind: "SERVICE_ORDER" }))).toEqual([
      "Ordem de serviço",
    ]);
    expect(texts(DeliveryKindBadge({ kind: "PICKUP" }))).toEqual(["Coleta"]);
  });

  it("draws nothing for a delivery, an absent kind or an unknown one", () => {
    expect(DeliveryKindBadge({ kind: "DELIVERY" })).toBeNull();
    expect(DeliveryKindBadge({ kind: undefined })).toBeNull();
    expect(DeliveryKindBadge({ kind: "RETURN" })).toBeNull();
  });
});

describe("the screens that name a delivery", () => {
  it("the delivery screen shows the same identifiers and badge as the card", () => {
    const detail = read("app/(protected)/delivery-detail.tsx");

    expect(detail).toMatch(
      /const identifiers = deliveryIdentifiersLabel\(delivery\);/,
    );
    expect(detail).toMatch(/<DeliveryKindBadge kind=\{delivery\.kind\} \/>/);
  });

  it("the pending screen names a queued step's delivery from the cached day", () => {
    const pending = read("app/(protected)/pending-submissions.tsx");
    const hook = read(
      "features/deliveries/hooks/use-queued-step-identifiers.ts",
    );

    expect(pending).toMatch(/const identifiers = identifiersOf\(item\);/);
    // The item's own company: the queue lists every company's items.
    expect(hook).toMatch(
      /getQueryData<MyDeliveriesResponse>\(\[\s*"my-deliveries",\s*step\.businessId,?\s*\]\)/,
    );
    expect(hook).toMatch(
      /deliveryOfQueuedStep\(step\.endpoint, cached\?\.data \?\? \[\]\)/,
    );
  });

  it("the chat indexes the cached day's codes for its delivery chips", () => {
    const chat = read("app/(protected)/(tabs)/chat.tsx");

    expect(chat).toMatch(
      /const deliveryCodes = useMemo\(\s*\(\) =>\s*deliveryCodeIndex\(deliveries\),\s*\[deliveries\],?\s*\);/,
    );
    expect(chat.match(/deliveryCodes=\{deliveryCodes\}/g)).toHaveLength(2);
  });
});
