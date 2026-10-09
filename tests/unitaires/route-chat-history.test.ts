import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The route shows its messages (decision 6.7; DLVP-CHAT-1).
 *
 * The app has no route screen: a route's section of the list is where the
 * driver looks at it. Before, the section only offered "Falar com a base
 * sobre esta rota"; what was said about the route appeared nowhere but in
 * the whole thread. The hook runs with react-query's `useQuery` captured;
 * the view is called directly and its tree read (as in
 * delivery-chat-history.test.ts).
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

const invalidateQueries = vi.fn(
  async (_filter: { queryKey: readonly unknown[] }) => undefined,
);
vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    invalidateQueries: (filter: { queryKey: readonly unknown[] }) =>
      invalidateQueries(filter),
  },
}));

type Element = { type: unknown; props: Record<string, unknown> };
type Component = (props: Record<string, unknown>) => unknown;

let useRouteChatMessages: typeof import("@/features/chat/hooks/use-delivery-chat-messages").useRouteChatMessages;
let refreshLinkedChatMessages: typeof import("@/features/chat/linked-messages").refreshLinkedChatMessages;
let refreshAllLinkedChatMessages: typeof import("@/features/chat/linked-messages").refreshAllLinkedChatMessages;
let RouteChatShortcut: Component;
let RouteChatShortcutView: Component;

beforeAll(async () => {
  ({ useRouteChatMessages } = await import(
    "@/features/chat/hooks/use-delivery-chat-messages"
  ));
  ({ refreshLinkedChatMessages, refreshAllLinkedChatMessages } = await import(
    "@/features/chat/linked-messages"
  ));

  ({ RouteChatShortcut, RouteChatShortcutView } = (await import(
    "@/components/screens/chat/route-chat-shortcut"
  )) as unknown as {
    RouteChatShortcut: Component;
    RouteChatShortcutView: Component;
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

const ROUTE = "0192b1c4-0000-4000-8000-0000000000aa";
const DELIVERY = "0192b1c4-0000-4000-8000-000000000001";

const route = { id: ROUTE, code: 42, name: "Zona Sul" };

const agentMessage = {
  id: "m1",
  kind: "TEXT",
  body: "Portão da doca 3 liberado",
  attachment_url: null,
  duration_ms: null,
  deliveryId: null,
  routeId: ROUTE,
  broadcast_id: null,
  client_submission_id: null,
  threadId: "thread-1",
  senderId: "user-agent",
  sender: { id: "user-agent", name: "Central" },
  delivery: null,
  created_at: "2026-09-29T12:01:00.000Z",
};

beforeEach(() => {
  lastQuery = null;
  queryData = undefined;
  navigate.mockReset();
  get.mockClear();
  invalidateQueries.mockClear();
  session.user.enabledModules = ["DELIVERIES"];
});

describe("asking for a route's messages", () => {
  it("reads the driver's own thread, narrowed to the route, three at a time", async () => {
    useRouteChatMessages(ROUTE);

    expect(lastQuery?.queryKey).toEqual(["chat-linked", "route", ROUTE]);
    expect(lastQuery?.enabled).toBe(true);

    await lastQuery?.queryFn();

    expect(get).toHaveBeenCalledWith(`/chat/list-messages?limit=3&routeId=${ROUTE}`);
  });

  it("asks nothing without Entregas", () => {
    session.user.enabledModules = ["FLEET"];

    useRouteChatMessages(ROUTE);

    expect(lastQuery?.enabled).toBe(false);
  });
});

describe("the route's section of the list", () => {
  it("shows what was said about the route, and opens the chat with the route as the chip", () => {
    queryData = { threadId: "thread-1", data: [agentMessage], nextCursor: null };

    const view = RouteChatShortcut({ route }) as Element;

    // The container hands the view its props; draw the view itself.
    const tree = (view.type as Component)(view.props);
    const texts = flatten(tree)
      .filter((element) => element.type === "Text")
      .map(textOf);

    expect(texts).toContain("Conversas sobre esta rota");
    expect(
      texts.some(
        (text) => text.startsWith("Central · ") && text.endsWith(" — Portão da doca 3 liberado"),
      ),
    ).toBe(true);

    const open = flatten(tree).find(
      (element) =>
        element.props?.accessibilityLabel === "Falar com a base sobre a Rota 42 · Zona Sul",
    );

    (open!.props.onPress as () => void)();

    expect(navigate).toHaveBeenCalledWith({
      pathname: "/chat",
      params: expect.objectContaining({ routeId: ROUTE, routeCode: "42", deliveryId: "" }),
    });
  });

  it("keeps only the shortcut while nothing was said about the route", () => {
    const tree = RouteChatShortcutView({
      route,
      messages: [],
      onOpenChat: () => undefined,
    });

    const texts = flatten(tree)
      .filter((element) => element.type === "Text")
      .map(textOf);

    expect(texts).toEqual(["Falar com a base sobre esta rota"]);
  });
});

describe("a message sent or arrived", () => {
  it("refreshes the previews of both its delivery and its route", () => {
    refreshLinkedChatMessages({ deliveryId: DELIVERY, routeId: ROUTE });
    refreshLinkedChatMessages({ deliveryId: null, routeId: null });

    expect(invalidateQueries.mock.calls.map(([filter]) => filter.queryKey)).toEqual([
      ["chat-linked", "delivery", DELIVERY],
      ["chat-linked", "route", ROUTE],
    ]);
  });
});

describe("pulling the list to refresh", () => {
  /**
   * The route previews hang off the list's sections, so the driver's one
   * refresh gesture must reach them too. Before, they refreshed only on a
   * send, a realtime arrival or their 30 s staleTime, so a pull showed the
   * new stops under the old conversation.
   */
  it("refreshes every linked preview, delivery and route alike", () => {
    refreshAllLinkedChatMessages();

    expect(invalidateQueries.mock.calls.map(([filter]) => filter.queryKey)).toEqual([
      ["chat-linked"],
    ]);
  });

  it("is what the deliveries tab's pull-to-refresh runs", () => {
    // The tab cannot be rendered here, so its source is read (as
    // chat-tab-wiring.test.ts does).
    const source = readFileSync(
      resolve(__dirname, "../..", "app/(protected)/(tabs)/deliveries.tsx"),
      "utf8",
    ).replace(/\r\n/g, "\n");

    const handler = source.match(/const handleRefresh = async \(\) => \{[\s\S]*?\n {2}\};/);

    expect(handler?.[0]).toContain("refreshAllLinkedChatMessages()");
  });
});
