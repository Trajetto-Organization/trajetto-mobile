import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { formatClock } from "@/features/deliveries/delivery-rules";
import type { OnTheWayView } from "@/features/deliveries/on-the-way-rules";

/**
 * "A caminho" on the day's list (decision 6.4).
 *
 * The state showed only on the delivery screen: from the list, the driver
 * could not tell which of the route's addresses they had told the base they
 * were heading to. The card now carries the same line as the detail, read
 * from the same view (`useOnTheWay().viewFor`). The card is called directly
 * and its tree read, as in route-chat-history.test.ts.
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
// The real palette, light scheme: NativeWind's hook needs a native runtime.
vi.mock("@/hooks/use-theme", async () => {
  const { themeColors } = await import("@/utils/theme-rules");
  return { useThemeColors: () => themeColors("light") };
});

vi.mock("@/components/screens/occurrences/occurrence-authorization-card", () => ({
  OccurrenceAuthorizationBadge: "OccurrenceAuthorizationBadge",
}));

type Element = { type: unknown; props: Record<string, unknown> };
type Component = (props: Record<string, unknown>) => unknown;

let DeliveryCard: Component;

beforeAll(async () => {
  ({ DeliveryCard } = (await import(
    "@/components/screens/deliveries/delivery-card"
  )) as unknown as { DeliveryCard: Component });
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

const textOf = (element: Element): string =>
  ([] as unknown[])
    .concat(element.props.children as unknown[])
    .flat(Infinity)
    .filter((part) => typeof part === "string" || typeof part === "number")
    .join("");

const texts = (tree: unknown): string[] =>
  flatten(tree)
    .filter((element) => element.type === "Text")
    .map(textOf);

const delivery = {
  id: "0192b1c4-0000-4000-8000-000000000001",
  code: "PED-1",
  recipient_name: "Maria Souza",
  status: "IN_TRANSIT",
  scheduled_date: "2026-09-29T00:00:00.000Z",
  street: "Rua A",
  address_number: "10",
  neighborhood: "Centro",
  city: "São Paulo",
  uf: "SP",
  shipper: { name: "Loja X" },
};

const SINCE = "2026-09-29T14:05:00.000Z";

const view = (overrides: Partial<OnTheWayView>): OnTheWayView => ({
  offer: false,
  current: false,
  since: null,
  queued: false,
  ...overrides,
});

const render = (onTheWay?: OnTheWayView | null) =>
  DeliveryCard({ delivery, onPress: () => undefined, position: 1, onTheWay });

describe("the delivery card's 'a caminho'", () => {
  it("says since when, on the stop the driver is heading to", () => {
    const tree = render(view({ current: true, since: SINCE }));

    expect(texts(tree)).toContain(`A caminho desde ${formatClock(SINCE)}`);
  });

  it("says it is still on the phone while the mark waits in the queue", () => {
    const tree = render(view({ current: true, since: SINCE, queued: true }));

    expect(texts(tree)).toContain(`A caminho desde ${formatClock(SINCE)} · salvo no aparelho`);
  });

  it("shows nothing on a stop that could be marked but is not the current one", () => {
    const tree = render(view({ offer: true }));

    expect(texts(tree).some((text) => text.startsWith("A caminho"))).toBe(false);
  });

  it("shows nothing when the list does not say (no view given)", () => {
    expect(texts(render(undefined)).some((text) => text.startsWith("A caminho"))).toBe(false);
    expect(texts(render(null)).some((text) => text.startsWith("A caminho"))).toBe(false);
  });

  it("is fed by the deliveries tab from the same view as the delivery screen", () => {
    // The tab cannot be rendered here, so its source is read.
    const tab = readFileSync(
      resolve(__dirname, "../..", "app/(protected)/(tabs)/deliveries.tsx"),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(tab).toContain("useOnTheWay(businessId)");
    expect(tab).toMatch(
      /onTheWay=\{onTheWay\.viewFor\(item\.delivery, deliveries, occurrenceTypes\)\}/,
    );
  });
});
