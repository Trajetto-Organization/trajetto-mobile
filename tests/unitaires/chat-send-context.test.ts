import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A message sent about a delivery or a route, driven through the real
 * conversation hook (decision 6.7; DLVP-CHAT-1).
 *
 * Before: only the delivery reached the API (never a route), the bubble
 * showed no context until the send landed, and a message citing a delivery
 * that had left the driver failed forever — each retry cited it again. Also
 * the chat tab's chip: the tab stays mounted, and a second "Falar com a base"
 * arrived as new params that the screen ignored.
 *
 * `react` is replaced by a minimal hook runtime (state, refs, memoised
 * callbacks, effects with deps, re-render on set), as in
 * chat-conversation-resync.test.ts; only the network, the socket and the
 * native modules are fakes.
 */
const runtime = vi.hoisted(() => {
  interface EffectSlot {
    kind: "effect";
    deps?: readonly unknown[];
    create: () => void | (() => void);
    destroy?: void | (() => void);
    dirty: boolean;
  }

  const slots: unknown[] = [];
  let cursor = 0;
  let renderFn: (() => unknown) | null = null;
  let output: unknown = null;
  let scheduled = false;

  const changed = (a?: readonly unknown[], b?: readonly unknown[]) =>
    !a ||
    !b ||
    a.length !== b.length ||
    a.some((value, index) => !Object.is(value, b[index]));

  const isEffect = (slot: unknown): slot is EffectSlot =>
    typeof slot === "object" && slot !== null && (slot as EffectSlot).kind === "effect";

  const react = {
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;

      if (!(index in slots)) {
        slots[index] = {
          value:
            typeof initial === "function" ? (initial as () => T)() : initial,
        };
      }

      const slot = slots[index] as { value: T };

      const set = (next: T | ((current: T) => T)) => {
        const value =
          typeof next === "function"
            ? (next as (current: T) => T)(slot.value)
            : next;

        if (Object.is(value, slot.value)) return;

        slot.value = value;
        scheduled = true;
      };

      return [slot.value, set] as const;
    },

    useRef<T>(initial: T) {
      const index = cursor++;

      if (!(index in slots)) slots[index] = { current: initial };

      return slots[index] as { current: T };
    },

    useCallback<T>(callback: T, deps: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index] as { callback: T; deps: readonly unknown[] } | undefined;

      if (previous && !changed(previous.deps, deps)) return previous.callback;

      slots[index] = { callback, deps };

      return callback;
    },

    useMemo<T>(factory: () => T, deps: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index] as { value: T; deps: readonly unknown[] } | undefined;

      if (previous && !changed(previous.deps, deps)) return previous.value;

      const value = factory();
      slots[index] = { value, deps };

      return value;
    },

    useEffect(create: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++;
      const previous = slots[index];

      if (isEffect(previous) && deps && !changed(previous.deps, deps)) return;

      slots[index] = {
        kind: "effect",
        deps,
        create,
        destroy: isEffect(previous) ? previous.destroy : undefined,
        dirty: true,
      } satisfies EffectSlot;
    },
  };

  function commit(): void {
    slots.forEach((slot) => {
      if (!isEffect(slot) || !slot.dirty) return;

      if (typeof slot.destroy === "function") slot.destroy();

      slot.dirty = false;
      slot.destroy = slot.create();
    });
  }

  function render(): void {
    let guard = 0;

    do {
      scheduled = false;
      cursor = 0;
      output = renderFn!();
      commit();
      guard += 1;
    } while (scheduled && guard < 50);
  }

  return {
    react,

    mount(fn: () => unknown) {
      slots.length = 0;
      renderFn = fn;
      render();
    },

    rerender() {
      if (scheduled) render();
    },

    /** A parent re-rendering with new props: no state changed here. */
    renderAgain() {
      render();
    },

    unmount() {
      slots.forEach((slot) => {
        if (isEffect(slot) && typeof slot.destroy === "function") slot.destroy();
      });
      slots.length = 0;
    },

    current<T>(): T {
      return output as T;
    },
  };
});

vi.mock("react", () => runtime.react);

const appState = vi.hoisted(() => ({
  currentState: "active" as string,
  listeners: new Set<(state: string) => void>(),
}));

vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: (_type: string, listener: (state: string) => void) => {
      appState.listeners.add(listener);

      return { remove: () => appState.listeners.delete(listener) };
    },
  },
}));

const focus = vi.hoisted(() => ({
  callback: null as null | (() => void | (() => void)),
}));

vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    focus.callback = callback;
  },
  usePathname: () => "/chat",
  useRouter: () => ({ navigate: () => undefined }),
}));

// A new submission id per message, as in production.
const uuids = vi.hoisted(() => ({ next: 0 }));

vi.mock("expo-crypto", () => ({
  randomUUID: () => `sub-${++uuids.next}`,
}));

const toast = vi.hoisted(() => vi.fn());

vi.mock("react-native-toast-message", () => ({
  default: { show: (...args: unknown[]) => toast(...args) },
}));

vi.mock("@/store/auth-store", () => {
  const state = {
    isAuthenticated: true,
    user: {
      id: "user-driver",
      businessId: "business-1",
      driverId: "driver-1",
      name: "Motorista",
    },
  };

  return {
    useAuthStore: (select: (value: typeof state) => unknown) => select(state),
  };
});

const invalidateQueries = vi.hoisted(() =>
  vi.fn(async (_filter: { queryKey: readonly unknown[] }) => undefined),
);

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries },
}));

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(async (_url: string, _body?: unknown): Promise<unknown> => ({})),
}));

vi.mock("@/utils/api", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public code?: string,
    ) {
      super(message);
    }
  }

  return {
    ApiError,
    apiClient: {
      get: (url: string) => api.get(url),
      post: (url: string, body?: unknown) => api.post(url, body),
    },
  };
});

const socketHandlers = vi.hoisted(
  () => new Map<string, Set<(payload: unknown) => void>>(),
);

/** Delivers a socket event to whatever the hooks bound. */
function fireSocket(event: string, payload: unknown): void {
  for (const handler of [...(socketHandlers.get(event) ?? [])]) handler(payload);
}

vi.mock("@/utils/socket", () => {
  const fake = {
    connected: true,
    on: (event: string, handler: (payload: unknown) => void) => {
      if (!socketHandlers.has(event)) socketHandlers.set(event, new Set());
      socketHandlers.get(event)!.add(handler);
    },
    off: (event: string, handler: (payload: unknown) => void) => {
      socketHandlers.get(event)?.delete(handler);
    },
    emit: () => undefined,
  };

  return {
    initializeSocket: async () => fake,
    getSocket: () => fake,
    socketCarriedLastAbsence: () => false,
    onRealtimeResync: () => () => undefined,
  };
});

vi.mock("@/features/media/upload-to-storage", () => ({
  uploadToStorage: async () => [{ key: "chatAttachments/business-1/file" }],
}));

vi.mock("@/features/chat/audio-cache", () => ({
  seedChatAudioCache: () => undefined,
}));

type Conversation = ReturnType<
  typeof import("@/features/chat/hooks/use-chat-conversation").useChatConversation
>;

type Chip = ReturnType<
  typeof import("@/features/chat/hooks/use-chat-context-chip").useChatContextChip
>;

let useChatConversation: typeof import("@/features/chat/hooks/use-chat-conversation").useChatConversation;
let useChatContextChip: typeof import("@/features/chat/hooks/use-chat-context-chip").useChatContextChip;
let useChatWithContext: typeof import("@/features/chat/hooks/use-chat-with-context").useChatWithContext;
let contextRules: typeof import("@/features/chat/chat-context");
let ApiErrorClass: new (message: string, status: number, code?: string) => Error;

beforeAll(async () => {
  ({ useChatConversation } = await import(
    "@/features/chat/hooks/use-chat-conversation"
  ));
  ({ useChatContextChip } = await import(
    "@/features/chat/hooks/use-chat-context-chip"
  ));
  ({ useChatWithContext } = await import(
    "@/features/chat/hooks/use-chat-with-context"
  ));
  contextRules = await import("@/features/chat/chat-context");
  ApiErrorClass = (await import("@/utils/api"))
    .ApiError as unknown as typeof ApiErrorClass;
});

// ---------------------------------------------------------------- fixtures
const THREAD = "11111111-1111-4111-8111-111111111111";
const DELIVERY = "0192b1c4-0000-4000-8000-000000000001";
const ROUTE = "0192b1c4-0000-4000-8000-0000000000aa";

const deliveryContext = () =>
  contextRules.chatContextOfDelivery({
    id: DELIVERY,
    recipient_name: "Mercado Central",
    stops: [{ route: { id: ROUTE, code: 42, name: "Zona Sul" } }],
  });

const routeContext = () =>
  contextRules.chatContextOfRoute({ id: ROUTE, code: 42, name: "Zona Sul" });

const OTHER_DELIVERY = "0192b1c4-0000-4000-8000-000000000002";

// Another stop of the same route.
const otherDeliveryContext = () =>
  contextRules.chatContextOfDelivery({
    id: OTHER_DELIVERY,
    recipient_name: "Padaria Sol",
    stops: [{ route: { id: ROUTE, code: 42, name: "Zona Sul" } }],
  });

const emptyPage = {
  threadId: THREAD,
  data: [],
  nextCursor: null,
  counterpartLastReadAt: null,
  counterpartDeliveredAt: null,
};

/** What the API answers for a sent message: the server's copy. */
function confirmed(body: Record<string, unknown>) {
  return {
    data: [
      {
        id: `server-${String(body.clientSubmissionId)}`,
        kind: body.kind,
        body: body.body ?? null,
        attachment_url: null,
        duration_ms: null,
        deliveryId: body.deliveryId ?? null,
        routeId: ROUTE,
        route: { id: ROUTE, code: 42, name: "Zona Sul" },
        broadcast_id: null,
        client_submission_id: body.clientSubmissionId,
        threadId: THREAD,
        senderId: "user-driver",
        sender: { id: "user-driver", name: "Motorista" },
        delivery: body.deliveryId
          ? { id: DELIVERY, recipient_name: "Mercado Central", status: "IN_TRANSIT" }
          : null,
        created_at: "2026-09-29T12:00:00.000Z",
      },
    ],
  };
}

const sends = () =>
  api.post.mock.calls
    .filter(([url]) => url === "/chat/send-message")
    .map(([, body]) => body as Record<string, unknown>);

async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await vi.advanceTimersByTimeAsync(0);
    runtime.rerender();
  }
}

const rejected = vi.fn();

async function openConversation(): Promise<() => Conversation> {
  runtime.mount(() => useChatConversation({ onContextRejected: rejected }));
  focus.callback?.();

  await settle();

  return () => runtime.current<Conversation>();
}

beforeEach(() => {
  vi.useFakeTimers();

  uuids.next = 0;
  api.get.mockReset();
  api.get.mockResolvedValue(emptyPage);
  api.post.mockReset();
  api.post.mockImplementation(async (url: string, body?: unknown) =>
    url === "/chat/send-message"
      ? confirmed(body as Record<string, unknown>)
      : {},
  );
  rejected.mockClear();
  toast.mockClear();
  invalidateQueries.mockClear();
});

const linkedRefreshes = () =>
  invalidateQueries.mock.calls
    .map(([filter]) => filter.queryKey)
    .filter((key) => key[0] === "chat-linked");

afterEach(() => {
  runtime.unmount();
  vi.useRealTimers();
});

// ------------------------------------------------------------------ sending
describe("a message sent with the chip up", () => {
  it("names the delivery to the API and shows the delivery and route at once", async () => {
    // Held, so the optimistic bubble can be inspected before the answer.
    let answer: (value: unknown) => void = () => undefined;

    api.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    const chat = await openConversation();

    chat().send({
      kind: "TEXT",
      body: "Cliente ausente",
      context: deliveryContext(),
    });
    await settle();

    expect(chat().messages[0]).toMatchObject({
      pending: true,
      deliveryId: DELIVERY,
      delivery: { id: DELIVERY, recipient_name: "Mercado Central" },
      routeId: ROUTE,
      route: { id: ROUTE, code: 42, name: "Zona Sul" },
    });

    // The delivery alone: the API tags the route that carries it.
    expect(sends()).toEqual([
      {
        driverIds: ["driver-1"],
        kind: "TEXT",
        body: "Cliente ausente",
        deliveryId: DELIVERY,
        clientSubmissionId: "sub-1",
      },
    ]);

    answer(confirmed(sends()[0]));
    await settle();

    expect(chat().messages[0]).toMatchObject({
      id: "server-sub-1",
      route: { id: ROUTE, code: 42 },
    });
  });

  it("refreshes the delivery's and the route's previews once the message is confirmed", async () => {
    const chat = await openConversation();

    chat().send({ kind: "TEXT", body: "Cliente ausente", context: deliveryContext() });
    await settle();

    // The route the API tagged on the confirmed copy.
    expect(linkedRefreshes()).toEqual([
      ["chat-linked", "delivery", DELIVERY],
      ["chat-linked", "route", ROUTE],
    ]);

    // A message about nothing in particular refreshes no delivery (only the
    // running route the API tagged it with).
    chat().send({ kind: "TEXT", body: "Bom dia" });
    await settle();

    expect(linkedRefreshes().filter((key) => key[1] === "delivery")).toHaveLength(1);
  });

  it("names the route when the message is about the route", async () => {
    const chat = await openConversation();

    chat().send({ kind: "TEXT", body: "Atraso na saída", context: routeContext() });
    await settle();

    expect(sends()[0]).toMatchObject({ routeId: ROUTE });
    expect(sends()[0]).not.toHaveProperty("deliveryId");
  });

  it("links every photo of a batch, and the voice note, to the same delivery", async () => {
    const chat = await openConversation();
    const context = deliveryContext();

    chat().sendMany(
      contextRules.composeImageBatch(
        [{ uri: "file:///a.jpg" }, { uri: "file:///b.jpg" }],
        "Avaria",
        context,
      ),
    );
    await settle();

    chat().send({
      kind: "AUDIO",
      uri: "file:///voice.m4a",
      durationMs: 4_000,
      context,
    });
    await settle();

    expect(sends().map((body) => body.deliveryId)).toEqual([
      DELIVERY,
      DELIVERY,
      DELIVERY,
    ]);

    // The caption closes the batch, once.
    expect(sends().map((body) => body.body)).toEqual([undefined, "Avaria", undefined]);
  });

  it("sends neither id without a chip", async () => {
    const chat = await openConversation();

    chat().send({ kind: "TEXT", body: "Bom dia" });
    await settle();

    expect(sends()[0]).not.toHaveProperty("deliveryId");
    expect(sends()[0]).not.toHaveProperty("routeId");
  });
});

// ------------------------------------------------------ a stale reference
describe("a delivery the API no longer accepts from this driver", () => {
  const refuseTheDeliveryOnce = () =>
    api.post.mockImplementationOnce(async () => {
      throw new ApiErrorClass(
        "Entrega não encontrada.",
        404,
        "CHAT_DELIVERY_NOT_FOUND",
      );
    });

  it("sends the same words again without the reference, and drops the chip", async () => {
    refuseTheDeliveryOnce();

    const chat = await openConversation();

    chat().send({
      kind: "TEXT",
      body: "Cliente ausente",
      context: deliveryContext(),
    });
    await settle();

    // Same submission id (nothing was written the first time), no reference
    // the second time, and no tap needed.
    expect(sends()).toHaveLength(2);
    expect(sends()[0]).toMatchObject({ deliveryId: DELIVERY, clientSubmissionId: "sub-1" });
    expect(sends()[1]).toMatchObject({ body: "Cliente ausente", clientSubmissionId: "sub-1" });
    expect(sends()[1]).not.toHaveProperty("deliveryId");
    expect(sends()[1]).not.toHaveProperty("routeId");

    expect(chat().messages).toHaveLength(1);
    expect(chat().messages[0]).toMatchObject({ id: "server-sub-1", delivery: null });
    expect(chat().messages[0].failed).toBeFalsy();

    // The screen is told what was refused (to drop a chip that still cites
    // it), and the driver is told once why.
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(rejected).toHaveBeenCalledWith({ deliveryId: DELIVERY });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info", text1: "Referência removida" }),
    );
  });

  it("does not cite it again for the rest of a photo batch", async () => {
    refuseTheDeliveryOnce();

    const chat = await openConversation();

    chat().sendMany(
      contextRules.composeImageBatch(
        [{ uri: "file:///a.jpg" }, { uri: "file:///b.jpg" }, { uri: "file:///c.jpg" }],
        "Avaria",
        deliveryContext(),
      ),
    );
    await settle();

    // One refusal, then every photo without the reference, in order.
    expect(sends().map((body) => [body.clientSubmissionId, body.deliveryId ?? null])).toEqual([
      ["sub-1", DELIVERY],
      ["sub-1", null],
      ["sub-2", null],
      ["sub-3", null],
    ]);

    expect(rejected).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(chat().messages.every((entry) => entry.delivery === null && !entry.failed)).toBe(true);
  });

  it("names the route when a message about a route is refused for it", async () => {
    api.post.mockImplementationOnce(async () => {
      throw new ApiErrorClass(
        "Esta rota não é do motorista da conversa.",
        400,
        "CHAT_ROUTE_OTHER_DRIVER",
      );
    });

    const chat = await openConversation();

    chat().send({ kind: "TEXT", body: "Atraso na saída", context: routeContext() });
    await settle();

    expect(rejected).toHaveBeenCalledWith({ routeId: ROUTE });
    expect(sends()[1]).not.toHaveProperty("routeId");
  });

  it("fails the bubble, reference kept, for any other refusal", async () => {
    api.post.mockImplementationOnce(async () => {
      throw new ApiErrorClass("Tente de novo.", 503, "STORAGE_UNAVAILABLE");
    });

    const chat = await openConversation();

    chat().send({
      kind: "TEXT",
      body: "Cliente ausente",
      context: deliveryContext(),
    });
    await settle();

    expect(sends()).toHaveLength(1);
    expect(chat().messages[0]).toMatchObject({
      failed: true,
      deliveryId: DELIVERY,
    });
    expect(rejected).not.toHaveBeenCalled();

    chat().retry(chat().messages[0]);
    await settle();

    expect(sends()[1]).toMatchObject({
      deliveryId: DELIVERY,
      clientSubmissionId: "sub-1",
    });
  });
});

// ------------------------------------------------------------ the chat tab
describe("the chat tab's chip", () => {
  it("follows every new 'Falar com a base' on the mounted tab, and stays removed otherwise", () => {
    let params: Record<string, string> = {};

    runtime.mount(() => useChatContextChip(params));
    expect(runtime.current<Chip>().context).toBeNull();

    // First tap, from a delivery: the tab is already mounted.
    params = contextRules.chatContextParams(deliveryContext(), 1);
    runtime.renderAgain();
    expect(runtime.current<Chip>().context).toEqual(deliveryContext());

    // Removed by the driver; later renders with the same params keep it off.
    runtime.current<Chip>().clear();
    runtime.rerender();
    runtime.renderAgain();
    expect(runtime.current<Chip>().context).toBeNull();

    // A second tap on the same delivery puts it back.
    params = contextRules.chatContextParams(deliveryContext(), 2);
    runtime.renderAgain();
    expect(runtime.current<Chip>().context).toEqual(deliveryContext());

    // Then a tap on a route replaces it.
    params = contextRules.chatContextParams(routeContext(), 3);
    runtime.renderAgain();
    expect(runtime.current<Chip>().context).toEqual(routeContext());
  });

  it("starts with the chip the screen was opened with", () => {
    const params = contextRules.chatContextParams(routeContext(), 9);

    runtime.mount(() => useChatContextChip(params));

    expect(runtime.current<Chip>().context).toEqual(routeContext());
  });

  it("goes on a refusal only while it still cites what was refused", () => {
    let params: Record<string, string> = contextRules.chatContextParams(
      deliveryContext(),
      1,
    );

    runtime.mount(() => useChatContextChip(params));

    // An older message about another delivery was refused: this chip stays.
    runtime.current<Chip>().dropRefused({ deliveryId: OTHER_DELIVERY });
    runtime.rerender();
    expect(runtime.current<Chip>().context).toEqual(deliveryContext());

    // So does a refused route-only message: this chip sends its delivery.
    runtime.current<Chip>().dropRefused({ routeId: ROUTE });
    runtime.rerender();
    expect(runtime.current<Chip>().context).toEqual(deliveryContext());

    // The refusal of what it cites takes it down.
    runtime.current<Chip>().dropRefused({ deliveryId: DELIVERY });
    runtime.rerender();
    expect(runtime.current<Chip>().context).toBeNull();

    // A route chip goes with its route.
    params = contextRules.chatContextParams(routeContext(), 2);
    runtime.renderAgain();
    runtime.current<Chip>().dropRefused({ routeId: ROUTE });
    runtime.rerender();
    expect(runtime.current<Chip>().context).toBeNull();
  });
});

// ------------------------------------------- the screen: chip + conversation
describe("a chat opened on a ticket (decision 14.5)", () => {
  type Screen = { chip: Chip; conversation: Conversation };

  const TICKET = "0192b1c4-0000-4000-8000-0000000000t1";

  const ticketParams = (at: number) =>
    contextRules.chatContextParams(
      {
        delivery: null,
        route: null,
        ticket: { id: TICKET, number: 128, subject: "Cliente ausente — Mercado Central" },
      },
      at,
    );

  async function openScreen(params: Record<string, string>): Promise<() => Screen> {
    runtime.mount(() => {
      const { chip, chat } = useChatWithContext(params);

      return { chip, conversation: chat };
    });
    focus.callback?.();

    await settle();

    return () => runtime.current<Screen>();
  }

  it("writes into that ticket, and learns the page's subjects for the separators", async () => {
    api.get.mockResolvedValue({
      ...emptyPage,
      tickets: [
        { id: TICKET, number: 128, status: "OPEN", subject: "Cliente ausente — Mercado Central", version: 2 },
      ],
    });

    const screen = await openScreen(ticketParams(10));

    expect(contextRules.chatContextLabel(screen().chip.context!)).toBe(
      "Assunto: #128 · Cliente ausente — Mercado Central",
    );
    expect(screen().conversation.tickets.get(TICKET)?.number).toBe(128);

    screen().conversation.send({
      kind: "TEXT",
      body: "Ainda aguardando",
      context: screen().chip.context,
    });
    await settle();

    expect(sends()[0]).toMatchObject({ ticketId: TICKET, body: "Ainda aguardando" });
    expect(sends()[0]).not.toHaveProperty("deliveryId");
  });

  it("sends the words again as a new subject when the ticket was closed meanwhile", async () => {
    api.post.mockImplementationOnce(async () => {
      throw new ApiErrorClass("O atendimento #128 já foi encerrado.", 409, "SUPPORT_TICKET_CLOSED");
    });

    const screen = await openScreen(ticketParams(11));

    screen().conversation.send({
      kind: "TEXT",
      body: "Posso seguir?",
      context: screen().chip.context,
    });
    await settle();

    expect(sends()).toHaveLength(2);
    expect(sends()[0]).toMatchObject({ ticketId: TICKET, clientSubmissionId: "sub-1" });
    expect(sends()[1]).toMatchObject({ body: "Posso seguir?", clientSubmissionId: "sub-1" });
    expect(sends()[1]).not.toHaveProperty("ticketId");

    expect(screen().chip.context).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info", text1: "Atendimento encerrado" }),
    );
  });

  it("puts the chip back to the default when the central closes its ticket", async () => {
    const screen = await openScreen(ticketParams(12));

    expect(screen().chip.context?.ticket?.id).toBe(TICKET);

    fireSocket("supportTicket", {
      type: "ticket.closed",
      ticket: {
        id: TICKET,
        number: 128,
        status: "CLOSED",
        subject: "Cliente ausente — Mercado Central",
        version: 5,
        close_outcome: "APPROVED",
      },
    });
    await settle();

    expect(screen().chip.context).toBeNull();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ text1: "Atendimento encerrado" }),
    );
  });
});

describe("a refusal that lands after the chat was opened on another delivery", () => {
  type Screen = { chip: Chip; conversation: Conversation };

  let params: Record<string, string> = {};

  /**
   * The chat tab's own wiring (the hook chat.tsx runs, pinned by
   * chat-tab-wiring.test.ts): the conversation tells the chip what was refused.
   */
  async function openScreen(): Promise<() => Screen> {
    runtime.mount(() => {
      const { chip, chat } = useChatWithContext(params);

      return { chip, conversation: chat };
    });
    focus.callback?.();

    await settle();

    return () => runtime.current<Screen>();
  }

  /** Holds the next send, to refuse it for its delivery later. */
  function holdNextSend(): () => void {
    let refuse: () => void = () => undefined;

    api.post.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuse = () =>
            reject(
              new ApiErrorClass("Entrega não encontrada.", 404, "CHAT_DELIVERY_NOT_FOUND"),
            );
        }),
    );

    return () => refuse();
  }

  it("keeps the newer chip", async () => {
    params = contextRules.chatContextParams(deliveryContext(), 1);

    const screen = await openScreen();
    const refuse = holdNextSend();

    screen().conversation.send({
      kind: "TEXT",
      body: "Cliente ausente",
      context: screen().chip.context,
    });
    await settle();

    // "Falar com a base" on another delivery while that send is in flight.
    params = contextRules.chatContextParams(otherDeliveryContext(), 2);
    runtime.renderAgain();
    expect(screen().chip.context).toEqual(otherDeliveryContext());

    refuse();
    await settle();

    // The words went again without the stale reference; the new chip stayed.
    expect(sends()).toHaveLength(2);
    expect(sends()[1]).not.toHaveProperty("deliveryId");
    expect(screen().chip.context).toEqual(otherDeliveryContext());
  });

  it("drops the chip that still cites the refused delivery", async () => {
    params = contextRules.chatContextParams(deliveryContext(), 3);

    const screen = await openScreen();
    const refuse = holdNextSend();

    screen().conversation.send({
      kind: "TEXT",
      body: "Cliente ausente",
      context: screen().chip.context,
    });
    await settle();

    refuse();
    await settle();

    expect(screen().chip.context).toBeNull();
  });
});
