import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The delivery shows its own messages (decision 6.7; DLVP-CHAT-1).
 *
 * One thread per driver, and each message may cite a delivery: the detail
 * screen asks the driver's own thread for the latest messages about it and
 * opens the chat with that delivery as the chip. The hook runs with
 * react-query's `useQuery` captured; the view is called directly and its tree
 * read (as in chat-image-cache-wiring.test.ts).
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

vi.mock("react", () => ({
  useMemo: <T>(factory: () => T) => factory(),
}));

vi.mock("react-native", () => ({
  Text: "Text",
  TouchableOpacity: "TouchableOpacity",
  View: "View",
}));

vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
// The theme hook reads NativeWind's scheme, which needs a React Native
// runtime; the palette it returns is plain data.
vi.mock("@/hooks/use-theme", async () => {
  const { themeColors } = await import("@/utils/theme-rules");
  return { useThemeColors: () => themeColors("light") };
});

const navigate = vi.fn();
vi.mock("expo-router", () => ({ useRouter: () => ({ navigate }) }));

let lastQuery: {
  queryKey: readonly unknown[];
  enabled: boolean;
  queryFn: () => Promise<unknown>;
} | null = null;

let queryData: unknown = undefined;

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: NonNullable<typeof lastQuery>) => {
    lastQuery = options;
    return { data: queryData };
  },
}));

const session = {
  user: {
    id: "user-driver",
    businessId: "business-1",
    driverId: "driver-1",
    enabledModules: ["DELIVERIES"] as string[],
  },
};

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (select: (state: typeof session) => unknown) => select(session),
}));

const get = vi.fn(async (_url: string): Promise<unknown> => ({}));
vi.mock("@/utils/api", () => ({ apiClient: { get: (url: string) => get(url) } }));

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries: async () => undefined },
}));

type Element = { type: unknown; props: Record<string, unknown> };
type Component = (props: Record<string, unknown>) => unknown;

let useDeliveryChatMessages: typeof import("@/features/chat/hooks/use-delivery-chat-messages").useDeliveryChatMessages;
let DeliveryChatHistory: Component;
let DeliveryChatHistoryView: Component;

beforeAll(async () => {
  ({ useDeliveryChatMessages } = await import(
    "@/features/chat/hooks/use-delivery-chat-messages"
  ));

  ({ DeliveryChatHistory, DeliveryChatHistoryView } = (await import(
    "@/components/screens/chat/delivery-chat-history"
  )) as unknown as {
    DeliveryChatHistory: Component;
    DeliveryChatHistoryView: Component;
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

const textOf = (element: Element): string =>
  ([] as unknown[])
    .concat(element.props.children as unknown[])
    .flat(Infinity)
    .filter((part) => typeof part === "string" || typeof part === "number")
    .join("");

const DELIVERY = "0192b1c4-0000-4000-8000-000000000001";
const ROUTE = "0192b1c4-0000-4000-8000-0000000000aa";

const agentMessage = {
  id: "m1",
  kind: "TEXT",
  body: "Cliente pediu para deixar na portaria",
  attachment_url: null,
  duration_ms: null,
  deliveryId: DELIVERY,
  broadcast_id: null,
  client_submission_id: null,
  threadId: "thread-1",
  senderId: "user-agent",
  sender: { id: "user-agent", name: "Central" },
  delivery: { id: DELIVERY, recipient_name: "Mercado Central", status: "IN_TRANSIT" },
  created_at: "2026-09-29T12:01:00.000Z",
};

beforeEach(() => {
  lastQuery = null;
  queryData = undefined;
  navigate.mockReset();
  get.mockClear();
  session.user.enabledModules = ["DELIVERIES"];
});

describe("asking for a delivery's messages", () => {
  it("reads the driver's own thread, narrowed to the delivery, three at a time", async () => {
    useDeliveryChatMessages(DELIVERY);

    expect(lastQuery?.queryKey).toEqual(["chat-linked", "delivery", DELIVERY]);
    expect(lastQuery?.enabled).toBe(true);

    await lastQuery?.queryFn();

    expect(get).toHaveBeenCalledWith(
      `/chat/list-messages?limit=3&deliveryId=${DELIVERY}`,
    );
  });

  it("asks nothing without Entregas", () => {
    session.user.enabledModules = ["FLEET"];

    useDeliveryChatMessages(DELIVERY);

    expect(lastQuery?.enabled).toBe(false);
  });

  it("hands the page over oldest first, ready to read", () => {
    queryData = { threadId: "thread-1", data: [agentMessage], nextCursor: null };

    expect(useDeliveryChatMessages(DELIVERY)).toEqual([
      {
        id: "m1",
        who: "Central",
        text: "Cliente pediu para deixar na portaria",
        at: "2026-09-29T12:01:00.000Z",
      },
    ]);
  });
});

describe("the section on the delivery", () => {
  const lineOf = (at: string): string => {
    const tree = DeliveryChatHistoryView({
      messages: [{ id: "m1", who: "Central", text: "Cliente ausente", at }],
      onOpenChat: () => undefined,
    });

    return flatten(tree)
      .filter((element) => element.type === "Text")
      .map(textOf)
      .find((text) => text.startsWith("Central · "))!;
  };

  it("dates a message said on another day, and gives only the time for today's", () => {
    // Noon UTC on both sides: the same calendar days in every Brazilian zone.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:30:00.000Z"));

    try {
      // A delivery reopened the next day: yesterday's message says so.
      expect(lineOf("2026-09-28T12:01:00.000Z")).toMatch(/^Central · 28\/09 às \d{2}:\d{2}$/);

      expect(lineOf("2026-09-29T12:01:00.000Z")).toMatch(/^Central · \d{2}:\d{2}$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws nothing while nothing was said about the delivery", () => {
    expect(
      DeliveryChatHistoryView({ messages: [], onOpenChat: () => undefined }),
    ).toBeNull();
  });

  it("shows who said what, and opens the chat with the delivery and its route as the chip", () => {
    queryData = { threadId: "thread-1", data: [agentMessage], nextCursor: null };

    const view = DeliveryChatHistory({
      delivery: {
        id: DELIVERY,
        recipient_name: "Mercado Central",
        stops: [{ route: { id: ROUTE, code: 42, name: "Zona Sul" } }],
      },
    }) as Element;

    // The container hands the view its props; draw the view itself.
    const tree = (view.type as Component)(view.props);
    const texts = flatten(tree)
      .filter((element) => element.type === "Text")
      .map(textOf);

    expect(texts).toContain("Conversas sobre esta entrega");
    expect(texts).toContain("Cliente pediu para deixar na portaria");
    expect(texts.some((text) => text.startsWith("Central · "))).toBe(true);

    const open = flatten(tree).find(
      (element) =>
        element.props?.accessibilityLabel === "Abrir a conversa sobre esta entrega",
    );

    (open!.props.onPress as () => void)();

    expect(navigate).toHaveBeenCalledWith({
      pathname: "/chat",
      params: expect.objectContaining({
        deliveryId: DELIVERY,
        recipient: "Mercado Central",
        routeId: ROUTE,
        routeCode: "42",
      }),
    });
  });
});
