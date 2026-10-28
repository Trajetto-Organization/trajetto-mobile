import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ClientChatMessage } from "@/features/chat/types";

/**
 * The thread shows what each message is about (decision 6.7): the delivery
 * chip, which opens the delivery, and the route the message was said during.
 *
 * Before, a bubble showed the delivery only, and nothing said which route a
 * message belonged to — the panel filters by route, the driver's phone did
 * not even name it. The bubble, the grid and the tags are called directly and
 * the tree they return is expanded (function components included) and read.
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
  Image: "RNImage",
  Text: "Text",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
}));

vi.mock("expo-image", () => ({ Image: "ExpoImage" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
// The theme hook reads NativeWind's scheme, which needs a React Native
// runtime; the palette it returns is plain data.
vi.mock("@/hooks/use-theme", async () => {
  const { themeColors } = await import("@/utils/theme-rules");
  return { useThemeColors: () => themeColors("light") };
});
vi.mock("@/components/screens/chat/audio-player", () => ({
  AudioPlayerBubble: "AudioPlayerBubble",
}));

type Element = { type: unknown; props: Record<string, unknown> };
type Component = (props: Record<string, unknown>) => unknown;

let ChatMessageBubble: Component;
let ChatImageGrid: Component;
let ChatMessageContextTags: Component;

beforeAll(async () => {
  ({ ChatMessageBubble } =
    (await import("@/components/screens/chat/message-bubble")) as unknown as {
      ChatMessageBubble: Component;
    });

  ({ ChatImageGrid } =
    (await import("@/components/screens/chat/image-grid-bubble")) as unknown as {
      ChatImageGrid: Component;
    });

  ({ ChatMessageContextTags } =
    (await import("@/components/screens/chat/message-context-tags")) as unknown as {
      ChatMessageContextTags: Component;
    });
});

/** Expands function components, so the tree is what the screen would draw. */
function expand(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object") return node;

  const element = node as Element;

  if (typeof element.type === "function") {
    return expand((element.type as Component)(element.props));
  }

  return {
    ...element,
    props: { ...element.props, children: expand(element.props.children) },
  };
}

function texts(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => texts(child, found));
    return found;
  }

  if (typeof node === "string" || typeof node === "number") {
    found.push(String(node));
    return found;
  }

  if (!node || typeof node !== "object") return found;

  const element = node as Element;

  if (element.type === "Text") {
    found.push(
      ([] as unknown[])
        .concat(element.props.children as unknown[])
        .flat(Infinity)
        .filter((part) => typeof part === "string" || typeof part === "number")
        .join(""),
    );

    return found;
  }

  texts(element.props?.children, found);

  return found;
}

function findButton(node: unknown, label: string): Element | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child, label);
      if (hit) return hit;
    }

    return null;
  }

  if (!node || typeof node !== "object") return null;

  const element = node as Element;

  if (element.props?.accessibilityLabel === label) return element;

  return findButton(element.props?.children, label);
}

const ROUTE = { id: "route-1", code: 42, name: "Zona Sul" };
const DELIVERY = {
  id: "delivery-1",
  recipient_name: "Mercado Central",
  status: "IN_TRANSIT",
};

function message(
  overrides: Partial<ClientChatMessage> = {},
): ClientChatMessage {
  return {
    id: "m1",
    kind: "TEXT",
    body: "Cliente ausente",
    attachment_url: null,
    duration_ms: null,
    deliveryId: null,
    routeId: null,
    route: null,
    broadcast_id: null,
    client_submission_id: null,
    threadId: "thread-1",
    senderId: "user-agent",
    sender: { id: "user-agent", name: "Central" },
    delivery: null,
    created_at: "2026-09-29T12:00:00.000Z",
    ...overrides,
  };
}

const bubbleProps = (entry: ClientChatMessage) => ({
  message: entry,
  isMine: false,
  showSenderName: false,
  counterpartReadAt: null,
  counterpartDeliveredAt: null,
  onPressImage: () => undefined,
  onPressDelivery: () => undefined,
  onRetry: () => undefined,
});

describe("a bubble", () => {
  it("names the route the message was said during, and the delivery it is about", () => {
    const tree = expand(
      ChatMessageBubble(
        bubbleProps(
          message({
            routeId: ROUTE.id,
            route: ROUTE,
            deliveryId: DELIVERY.id,
            delivery: DELIVERY,
          }),
        ),
      ),
    );

    const shown = texts(tree);

    expect(shown).toContain("Rota 42 · Zona Sul");
    expect(shown).toContain("Entrega: Mercado Central");
  });

  it("names the delivery by its order code too, from the cached day's index", () => {
    // The API's chat payload names the delivery by recipient only; the code
    // comes from the cached list (deliveryCodeIndex), first so a cut chip shows it.
    const tree = expand(
      ChatMessageBubble({
        ...bubbleProps(
          message({ deliveryId: DELIVERY.id, delivery: DELIVERY }),
        ),
        deliveryCodes: new Map([[DELIVERY.id, "4815"]]),
      }),
    );

    expect(texts(tree)).toContain("Entrega: Pedido 4815 · Mercado Central");
    expect(
      findButton(tree, "Abrir entrega de Pedido 4815 · Mercado Central"),
    ).not.toBeNull();
  });

  it("names it by the recipient alone when the cache does not know its code", () => {
    const tree = expand(
      ChatMessageBubble({
        ...bubbleProps(
          message({ deliveryId: DELIVERY.id, delivery: DELIVERY }),
        ),
        deliveryCodes: new Map([["another-delivery", "999"]]),
      }),
    );

    expect(texts(tree)).toContain("Entrega: Mercado Central");
  });

  it("names a route with no name by its number", () => {
    const tree = expand(
      ChatMessageBubble(
        bubbleProps(message({ route: { id: "route-2", code: 7, name: null } })),
      ),
    );

    expect(texts(tree)).toContain("Rota 7");
  });

  it("opens the delivery from its chip", () => {
    const opened: string[] = [];

    const tree = expand(
      ChatMessageContextTags({
        delivery: DELIVERY,
        route: ROUTE,
        isMine: true,
        onPressDelivery: (id: string) => opened.push(id),
      }),
    );

    const chip = findButton(tree, "Abrir entrega de Mercado Central");

    expect(chip).not.toBeNull();
    (chip!.props.onPress as () => void)();
    expect(opened).toEqual(["delivery-1"]);
  });

  it("draws nothing for a message about nothing, or from an API without the keys", () => {
    expect(
      ChatMessageContextTags({
        delivery: null,
        route: null,
        isMine: false,
        onPressDelivery: () => undefined,
      }),
    ).toBeNull();

    const legacy = message();
    delete (legacy as Partial<ClientChatMessage>).route;
    delete (legacy as Partial<ClientChatMessage>).routeId;

    expect(texts(expand(ChatMessageBubble(bubbleProps(legacy))))).toEqual([
      "Cliente ausente",
      expect.any(String),
    ]);
  });
});

describe("a photo grid", () => {
  it("names the batch's route once, whichever photo carries it", () => {
    const photo = (
      id: string,
      minute: number,
      overrides: Partial<ClientChatMessage> = {},
    ) =>
      message({
        id,
        kind: "IMAGE",
        body: null,
        attachment_url: `https://storage.example.com/chat/${id}.jpg`,
        created_at: `2026-09-29T12:0${minute}:00.000Z`,
        ...overrides,
      });

    const tree = expand(
      ChatImageGrid({
        messages: [
          photo("p1", 0),
          photo("p2", 1, { route: ROUTE, routeId: ROUTE.id }),
        ],
        isMine: false,
        showSenderName: false,
        counterpartReadAt: null,
        counterpartDeliveredAt: null,
        onPressImage: () => undefined,
        onPressDelivery: () => undefined,
      }),
    );

    expect(
      texts(tree).filter((text) => text === "Rota 42 · Zona Sul"),
    ).toHaveLength(1);
  });
});
