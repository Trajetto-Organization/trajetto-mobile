import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The open conversation, driven for real outside a renderer (MOB-05, MOB-09,
 * MOB-21).
 *
 * The tab stays mounted, the socket is paused in the background and the API
 * has no replay. Before this, the screen loaded once, on mount: a message the
 * SAC sent while the driver was in a tunnel never appeared until the app was
 * restarted, `mark-read` told the SAC the driver had read messages the phone
 * never received, a broadcast of twenty messages cost twenty `mark-read`
 * POSTs, and the driver's own voice note asked to be downloaded when the
 * socket echo beat the HTTP answer.
 *
 * `react` is replaced by a minimal hook runtime (state, refs, memoised
 * callbacks, effects with deps, re-render on set) so the hook's own code runs
 * unchanged; only the network, the socket and the native modules are fakes.
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
  blur: null as null | void | (() => void),
}));

// `useRouter` answers one stable object, as expo-router does: the realtime
// hook's socket effect depends on it.
const router = vi.hoisted(() => ({ navigate: () => undefined }));

vi.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    focus.callback = callback;
  },
  usePathname: () => "/chat",
  useRouter: () => router,
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "sub-1" }));

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
  vi.fn(async (_filter: { queryKey: unknown }) => undefined),
);

vi.mock("@/providers/query-provider", () => ({
  queryClient: { invalidateQueries },
}));

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(async (_url: string, _body?: unknown) => ({})),
}));

vi.mock("@/utils/api", () => {
  class ApiError extends Error {
    code?: string;
  }

  return {
    ApiError,
    apiClient: {
      get: (url: string) => api.get(url),
      post: (url: string, body?: unknown) => api.post(url, body),
    },
  };
});

// One socket for the whole app, as in production: several hooks listen to
// the same event, and `connected` is what the conversation reads to know
// whether the live list can be trusted.
const socket = vi.hoisted(() => ({
  handlers: new Map<string, Set<(payload?: unknown) => void>>(),
  resync: new Set<() => void>(),
  connected: true,
}));

vi.mock("@/utils/socket", () => {
  const fake = {
    get connected() {
      return socket.connected;
    },
    on: (event: string, handler: (payload?: unknown) => void) => {
      if (!socket.handlers.has(event)) socket.handlers.set(event, new Set());
      socket.handlers.get(event)!.add(handler);
    },
    off: (event: string, handler?: (payload?: unknown) => void) => {
      if (handler) socket.handlers.get(event)?.delete(handler);
      else socket.handlers.delete(event);
    },
    emit: () => undefined,
  };

  return {
    initializeSocket: async () => fake,
    getSocket: () => fake,
    // Every return from the background here comes after the socket was
    // paused (a "disconnect" is emitted first): it never carried the absence.
    socketCarriedLastAbsence: () => false,
    onRealtimeResync: (listener: () => void) => {
      socket.resync.add(listener);

      return () => {
        socket.resync.delete(listener);
      };
    },
  };
});

// An upload that never finishes: the socket echo always wins the race here.
vi.mock("@/features/media/upload-to-storage", () => ({
  uploadToStorage: () => new Promise(() => undefined),
}));

const seedChatAudioCache = vi.hoisted(() => vi.fn());

vi.mock("@/features/chat/audio-cache", () => ({
  seedChatAudioCache: (...args: unknown[]) => seedChatAudioCache(...args),
}));

let cancelChatUnreadRefresh: () => void = () => undefined;

type Conversation = ReturnType<
  typeof import("@/features/chat/hooks/use-chat-conversation").useChatConversation
>;

let useChatConversation: typeof import("@/features/chat/hooks/use-chat-conversation").useChatConversation;
let useChatRealtime: typeof import("@/features/chat/use-chat-realtime").useChatRealtime;

beforeAll(async () => {
  ({ useChatConversation } = await import(
    "@/features/chat/hooks/use-chat-conversation"
  ));
  ({ useChatRealtime } = await import("@/features/chat/use-chat-realtime"));

  // The badge refresh is a module singleton; a window left open by one test
  // (its fake timer discarded) must not swallow the next test's refresh.
  // Loaded softly so this suite still runs, and fails on behaviour, against
  // a tree without the module.
  const unread = (await import("@/features/chat/unread-refresh").catch(
    () => null,
  )) as { cancelChatUnreadRefresh?: () => void } | null;

  cancelChatUnreadRefresh = unread?.cancelChatUnreadRefresh ?? (() => undefined);
});

// ---------------------------------------------------------------- fixtures
const DRIVER = "user-driver";
const AGENT = "user-agent";

const at = (minute: number) =>
  new Date(Date.UTC(2026, 8, 28, 12, minute)).toISOString();

function message(id: string, minute: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "TEXT",
    body: id,
    attachment_url: null,
    duration_ms: null,
    deliveryId: null,
    broadcast_id: null,
    client_submission_id: null,
    threadId: "11111111-1111-4111-8111-111111111111",
    senderId: AGENT,
    sender: { id: AGENT, name: "Central" },
    delivery: null,
    created_at: at(minute),
    ...overrides,
  };
}

/** A `/chat/list-messages` answer: newest first, as the API sends it. */
function page(
  messages: ReturnType<typeof message>[],
  nextCursor: { created_at: string; id: string } | null = null,
) {
  return {
    threadId: "11111111-1111-4111-8111-111111111111",
    data: [...messages].reverse(),
    nextCursor,
    counterpartLastReadAt: null,
    counterpartDeliveredAt: null,
  };
}

/** A GET answer the test releases by hand. */
function deferredPage() {
  let resolve: (value: ReturnType<typeof page>) => void = () => undefined;

  const promise = new Promise<ReturnType<typeof page>>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

const markReadCalls = () =>
  api.post.mock.calls.filter(([url]) => url === "/chat/mark-read");

/** The conversation's own head-of-thread GETs (the realtime hook asks for 30). */
const conversationFetches = () =>
  api.get.mock.calls.filter(([url]) => url === "/chat/list-messages?limit=40");

const reconcileFetches = () =>
  api.get.mock.calls.filter(([url]) => url === "/chat/list-messages?limit=30");

const badgeRefetches = () =>
  invalidateQueries.mock.calls.filter(
    ([filter]) =>
      JSON.stringify(filter.queryKey) === JSON.stringify(["chat-unread"]),
  ).length;

function emit(event: string, payload?: unknown): void {
  [...(socket.handlers.get(event) ?? [])].forEach((handler) => handler(payload));
}

function reconnect(): void {
  [...socket.resync].forEach((listener) => listener());
}

function goToForeground(): void {
  appState.currentState = "active";
  [...appState.listeners].forEach((listener) => listener("active"));
}

function blurTab(): void {
  if (typeof focus.blur === "function") focus.blur();
  focus.blur = null;
}

function focusTab(): void {
  focus.blur = focus.callback?.();
}

async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await vi.advanceTimersByTimeAsync(0);
    runtime.rerender();
  }
}

async function openConversation(
  initial: ReturnType<typeof page>,
  options: { withRealtime?: boolean } = {},
): Promise<() => Conversation> {
  api.get.mockResolvedValueOnce(initial);

  runtime.mount(() => {
    // The protected layout runs the realtime hook on every screen.
    if (options.withRealtime) useChatRealtime();

    return useChatConversation();
  });

  // The chat tab is the focused screen.
  focusTab();

  await settle();

  return () => runtime.current<Conversation>();
}

beforeEach(() => {
  vi.useFakeTimers();
  cancelChatUnreadRefresh();

  appState.currentState = "active";
  appState.listeners.clear();
  focus.callback = null;
  focus.blur = null;
  socket.handlers.clear();
  socket.resync.clear();
  socket.connected = true;

  api.get.mockReset();
  api.post.mockClear();
  invalidateQueries.mockClear();
  seedChatAudioCache.mockClear();
  toast.mockClear();
});

afterEach(() => {
  runtime.unmount();
  vi.useRealTimers();
});

const ids = (conversation: Conversation) =>
  conversation.messages.map((entry) => entry.id);

// -------------------------------------------------------------- first load
describe("the first load while the socket is already live", () => {
  it("keeps a message the socket delivered while the first page was on its way", async () => {
    const first = deferredPage();
    api.get.mockReturnValueOnce(first.promise);

    runtime.mount(() => useChatConversation());
    focusTab();
    await settle();

    // The server took the page's snapshot before m3 existed; m3 then came
    // by socket while the answer was still travelling.
    emit("chatMessage", message("m3", 3));
    await settle();

    first.resolve(page([message("m1", 1), message("m2", 2)], { created_at: at(1), id: "m1" }));
    await settle();

    const chat = runtime.current<Conversation>();

    expect(ids(chat)).toEqual(["m1", "m2", "m3"]);

    // The page's cursor still leads to the older history.
    expect(chat.hasOlder).toBe(true);

    // And m3 is what the driver has read: it is on screen.
    await vi.advanceTimersByTimeAsync(800);
    expect(markReadCalls()).toHaveLength(1);
    expect((markReadCalls()[0][1] as { readAt: string }).readAt).toBe(at(3));
  });

  it("runs a reconnection that lands during the first load once that load ends", async () => {
    const first = deferredPage();
    api.get.mockReturnValueOnce(first.promise);

    runtime.mount(() => useChatConversation());
    focusTab();
    await settle();

    // The socket dropped and came back while the first GET was in flight:
    // that answer may predate what the SAC sent in between.
    api.get.mockResolvedValueOnce(
      page([message("m1", 1), message("m2", 2), message("m3", 3)]),
    );
    reconnect();
    await settle();

    first.resolve(page([message("m1", 1), message("m2", 2)]));
    await settle();

    expect(conversationFetches()).toHaveLength(2);
    expect(ids(runtime.current<Conversation>())).toEqual(["m1", "m2", "m3"]);
  });
});

// ------------------------------------------------------- first connection
describe("the socket's first connection after a load made without it", () => {
  it("catches up on what the SAC sent before the room was joined, and reads nothing past what is on screen", async () => {
    // The cold start from a chat push: the first page is fetched while the
    // socket is still connecting.
    socket.connected = false;

    const chat = await openConversation(page([message("m1", 1)]));
    await vi.advanceTimersByTimeAsync(800);
    api.post.mockClear();

    // m2 was sent after that page's snapshot and before the socket joined
    // the room: it is in neither. A first connection is not announced as a
    // resync, so this screen has to ask.
    const catchUp = deferredPage();
    api.get.mockReturnValueOnce(catchUp.promise);

    socket.connected = true;
    emit("connect");
    await settle();

    expect(conversationFetches(), "a primeira conexão não buscou o que faltou").toHaveLength(2);

    // m3 comes live while that page is still on its way: m2 is not on
    // screen yet, so the SAC must not be told it was read.
    emit("chatMessage", message("m3", 3));
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(markReadCalls()).toHaveLength(0);

    catchUp.resolve(page([message("m1", 1), message("m2", 2)]));
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(ids(chat())).toEqual(["m1", "m2", "m3"]);
    expect(chat().messages.some((entry) => entry.afterGap)).toBe(false);
    expect(markReadCalls()).toHaveLength(1);
    expect((markReadCalls()[0][1] as { readAt: string }).readAt).toBe(at(3));

    // From here the live socket answers for the thread: coming back to the
    // tab costs nothing.
    blurTab();
    vi.advanceTimersByTime(60_000);
    focusTab();
    await settle();

    expect(conversationFetches()).toHaveLength(2);
  });

  it("catches up when the socket connected before the conversation started listening to it", async () => {
    socket.connected = false;

    api.get.mockResolvedValueOnce(page([message("m1", 1)]));
    api.get.mockResolvedValueOnce(page([message("m1", 1), message("m2", 2)]));

    runtime.mount(() => useChatConversation());

    // Connected while the listeners were still being attached: no
    // `connect` event reaches this screen.
    socket.connected = true;
    focusTab();
    await settle();

    expect(conversationFetches()).toHaveLength(2);
    expect(ids(runtime.current<Conversation>())).toEqual(["m1", "m2"]);
  });
});

// ------------------------------------------------------------------ resync
describe("catching up after the socket comes back", () => {
  it("shows what the SAC sent while the socket was down, without dropping the history on screen", async () => {
    const olderCursor = { created_at: at(1), id: "m1" };
    const chat = await openConversation(
      page([message("m1", 1), message("m2", 2)], olderCursor),
    );

    expect(ids(chat())).toEqual(["m1", "m2"]);
    expect(socket.resync.size, "a conversa não escuta a reconexão").toBe(1);

    // m3 was sent while the phone was in a tunnel: it never came by socket.
    api.get.mockResolvedValueOnce(
      page([message("m2", 2), message("m3", 3)], { created_at: at(2), id: "m2" }),
    );

    reconnect();
    await settle();

    expect(api.get).toHaveBeenLastCalledWith("/chat/list-messages?limit=40");
    expect(ids(chat())).toEqual(["m1", "m2", "m3"]);

    // "Mensagens anteriores" still continues from the older history.
    expect(chat().hasOlder).toBe(true);
  });

  it("stops listening when the screen goes away", async () => {
    await openConversation(page([message("m1", 1)]));

    runtime.unmount();

    expect(socket.resync.size).toBe(0);
  });

  it("fetches what was missed when the driver pulls the list, and says so if it fails", async () => {
    const chat = await openConversation(page([message("m1", 1)]));

    api.get.mockRejectedValueOnce(new Error("offline"));

    await chat().refresh();
    await settle();

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ text1: "Não foi possível atualizar a conversa" }),
    );

    // A readable conversation is never swapped for the error screen.
    expect(ids(chat())).toEqual(["m1"]);
    expect(chat().loadError).toBe("");
  });
});

// ------------------------------------------------------- request volume
describe("what a catch-up costs", () => {
  it("fetches nothing for a reconnection while the driver is on another tab, and catches up when they come back", async () => {
    const chat = await openConversation(page([message("m1", 1)]));

    blurTab();

    reconnect();
    await settle();

    expect(conversationFetches(), "buscou para uma tela que ninguém vê").toHaveLength(1);

    // Back on the chat tab, a second later: the reconnection is owed, so
    // not even the floor skips it.
    api.get.mockResolvedValueOnce(page([message("m1", 1), message("m2", 2)]));
    vi.advanceTimersByTime(1_000);
    focusTab();
    await settle();

    expect(conversationFetches()).toHaveLength(2);
    expect(ids(chat())).toEqual(["m1", "m2"]);
  });

  it("does not stitch a hole into the thread when the live socket delivered past what it missed", async () => {
    const chat = await openConversation(page([message("m1", 1)]));

    blurTab();

    // A long tunnel: m2..m49 were sent while the socket was down.
    socket.connected = false;
    emit("disconnect");

    socket.connected = true;
    reconnect();
    await settle();

    // Back online, the socket delivers m60 live before anyone catches up.
    emit("chatMessage", message("m60", 60));
    await settle();

    api.get.mockResolvedValueOnce(
      page(
        [message("m50", 50), message("m51", 51), message("m60", 60)],
        { created_at: at(50), id: "m50" },
      ),
    );
    focusTab();
    await settle();

    // Not m1 | hole | m50: the page is the history, and "Mensagens
    // anteriores" pages back through m2..m49.
    expect(ids(chat())).toEqual(["m50", "m51", "m60"]);
    expect(chat().hasOlder).toBe(true);
  });

  it("does not refetch on a tab focus when the socket stayed connected since the last sync", async () => {
    await openConversation(page([message("m1", 1)]));

    blurTab();

    // The live socket keeps merging while the driver is away.
    emit("chatMessage", message("m2", 2));
    await settle();

    vi.advanceTimersByTime(60_000);
    focusTab();
    await settle();

    expect(conversationFetches()).toHaveLength(1);
  });

  it("does refetch on a tab focus after the socket dropped", async () => {
    const chat = await openConversation(page([message("m1", 1)]));

    blurTab();

    socket.connected = false;
    emit("disconnect");

    api.get.mockResolvedValueOnce(page([message("m1", 1), message("m2", 2)]));
    vi.advanceTimersByTime(60_000);
    focusTab();
    await settle();

    expect(conversationFetches()).toHaveLength(2);
    expect(ids(chat())).toEqual(["m1", "m2"]);
  });

  it("lets the conversation's own catch-up stand in for the realtime hook's download while it is on screen", async () => {
    await openConversation(page([message("m1", 1)]), { withRealtime: true });

    // Back from the background: the socket was paused and reconnects.
    appState.currentState = "background";
    socket.connected = false;
    emit("disconnect");

    api.get.mockResolvedValue(page([message("m1", 1)]));

    vi.advanceTimersByTime(60_000);
    goToForeground();
    socket.connected = true;
    emit("connect");
    reconnect();
    await settle();

    expect(reconcileFetches(), "o mesmo trecho baixado duas vezes").toHaveLength(0);

    // Off the chat tab, the realtime hook is the only one confirming delivery.
    blurTab();
    appState.currentState = "background";
    socket.connected = false;
    emit("disconnect");

    vi.advanceTimersByTime(60_000);
    goToForeground();
    await settle();

    expect(reconcileFetches()).toHaveLength(1);
  });
});

// --------------------------------------------------------------- mark-read
describe("telling the SAC what the driver read", () => {
  it("reports the newest message on screen as readAt — never the server clock", async () => {
    await openConversation(page([message("m1", 1), message("m2", 2)]));

    await vi.advanceTimersByTimeAsync(800);

    const calls = markReadCalls();

    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({
      threadId: "11111111-1111-4111-8111-111111111111",
      readAt: at(2),
    });
  });

  it("turns a broadcast of twenty messages into one mark-read and one badge refetch", async () => {
    await openConversation(page([message("m1", 1)]));

    // The opening's own mark-read, and the badge refetch that follows it.
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(800);

    api.post.mockClear();
    invalidateQueries.mockClear();

    for (let index = 0; index < 20; index += 1) {
      emit("chatMessage", message(`b${index}`, 10 + index, { broadcast_id: "broadcast-1" }));
    }

    await settle();
    await vi.advanceTimersByTimeAsync(800);
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    const calls = markReadCalls();

    expect(calls).toHaveLength(1);
    expect((calls[0][1] as { readAt: string }).readAt).toBe(at(29));
    expect(badgeRefetches()).toBe(1);
  });

  it("keeps it at one badge refetch with the app-wide realtime hook also hearing the burst", async () => {
    await openConversation(page([message("m1", 1)]), { withRealtime: true });

    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(800);
    await settle();

    api.post.mockClear();
    invalidateQueries.mockClear();

    for (let index = 0; index < 20; index += 1) {
      emit("chatMessage", message(`b${index}`, 10 + index, { broadcast_id: "broadcast-1" }));
    }

    await settle();

    for (let step = 0; step < 4; step += 1) {
      await vi.advanceTimersByTimeAsync(800);
      await settle();
    }

    expect(markReadCalls()).toHaveLength(1);

    // One refetch, after the cursor moved: the arrival's own request waited
    // for the mark-read instead of reading the old cursor first.
    expect(badgeRefetches()).toBe(1);

    const markReadOrder = api.post.mock.invocationCallOrder[
      api.post.mock.calls.findIndex(([url]) => url === "/chat/mark-read")
    ];

    expect(invalidateQueries.mock.invocationCallOrder[0]).toBeGreaterThan(markReadOrder);
  });

  it("does not mark as read what lands below the fold while the driver reads older history", async () => {
    const chat = await openConversation(page([message("m1", 1)]));
    await vi.advanceTimersByTimeAsync(800);
    api.post.mockClear();

    // Scrolled up, reading the past.
    chat().setViewingLatest(false);

    emit("chatMessage", message("m2", 2));
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(ids(chat())).toEqual(["m1", "m2"]);
    expect(markReadCalls()).toHaveLength(0);

    // Back at the bottom: m2 is in front of the driver now.
    chat().setViewingLatest(true);
    await vi.advanceTimersByTimeAsync(800);

    expect(markReadCalls()).toHaveLength(1);
    expect((markReadCalls()[0][1] as { readAt: string }).readAt).toBe(at(2));
  });

  it("does not mark as read what arrived while the driver was on another screen, until they come back", async () => {
    const chat = await openConversation(page([message("m1", 1)]));
    await vi.advanceTimersByTimeAsync(800);
    api.post.mockClear();

    blurTab();

    emit("chatMessage", message("m2", 2));
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(ids(chat())).toEqual(["m1", "m2"]);
    expect(markReadCalls()).toHaveLength(0);

    // Back on the conversation: m2 is in front of the driver now.
    focusTab();
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(markReadCalls()).toHaveLength(1);
    expect((markReadCalls()[0][1] as { readAt: string }).readAt).toBe(at(2));
  });

  it("does not report as read a message the socket delivered above a hole, until the catch-up fills it", async () => {
    const chat = await openConversation(page([message("m1", 1)]));
    await vi.advanceTimersByTimeAsync(800);
    api.post.mockClear();

    // A tunnel with the conversation on screen: m2..m59 were sent meanwhile.
    socket.connected = false;
    emit("disconnect");
    socket.connected = true;
    emit("connect");

    // The announced resync is spread over a couple of seconds, and m60
    // comes live before it.
    emit("chatMessage", message("m60", 60));
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(ids(chat())).toEqual(["m1", "m60"]);
    expect(markReadCalls(), "leitura marcada por cima do buraco").toHaveLength(0);

    // A connection after a drop is left to that announcement.
    expect(conversationFetches()).toHaveLength(1);

    api.get.mockResolvedValueOnce(
      page(
        [message("m50", 50), message("m51", 51), message("m60", 60)],
        { created_at: at(50), id: "m50" },
      ),
    );
    reconnect();
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(ids(chat())).toEqual(["m50", "m51", "m60"]);
    expect(markReadCalls()).toHaveLength(1);
    expect((markReadCalls()[0][1] as { readAt: string }).readAt).toBe(at(60));
  });

  it("does not report it either when the driver comes back to the tab before the catch-up lands", async () => {
    const chat = await openConversation(page([message("m1", 1)]));
    await vi.advanceTimersByTimeAsync(800);
    api.post.mockClear();

    blurTab();

    socket.connected = false;
    emit("disconnect");
    socket.connected = true;
    emit("connect");
    reconnect();
    await settle();

    emit("chatMessage", message("m60", 60));
    await settle();

    // Back on the conversation: the owed catch-up is still on its way.
    const catchUp = deferredPage();
    api.get.mockReturnValueOnce(catchUp.promise);

    focusTab();
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(conversationFetches()).toHaveLength(2);
    expect(markReadCalls()).toHaveLength(0);

    catchUp.resolve(
      page(
        [message("m50", 50), message("m51", 51), message("m60", 60)],
        { created_at: at(50), id: "m50" },
      ),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(ids(chat())).toEqual(["m50", "m51", "m60"]);
    expect(markReadCalls()).toHaveLength(1);
    expect((markReadCalls()[0][1] as { readAt: string }).readAt).toBe(at(60));
  });

  it("marks as read what a reconnection in the background brought only once the driver opens the app on it", async () => {
    const chat = await openConversation(page([message("m1", 1)]));
    await vi.advanceTimersByTimeAsync(800);
    api.post.mockClear();

    appState.currentState = "background";
    socket.connected = false;
    emit("disconnect");

    // Nobody is looking: nothing is fetched and nothing is read.
    reconnect();
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(conversationFetches()).toHaveLength(1);
    expect(markReadCalls()).toHaveLength(0);

    // The driver opens the app on the conversation.
    api.get.mockResolvedValueOnce(page([message("m1", 1), message("m2", 2)]));
    goToForeground();
    await settle();
    await vi.advanceTimersByTimeAsync(800);

    expect(ids(chat())).toEqual(["m1", "m2"]);
    expect(markReadCalls()).toHaveLength(1);
    expect((markReadCalls()[0][1] as { readAt: string }).readAt).toBe(at(2));
  });
});

// -------------------------------------------------------------- own echo
describe("the driver's own voice note coming back through the socket", () => {
  it("is filed in the audio cache under the server id before it replaces the optimistic bubble", async () => {
    const chat = await openConversation(page([message("m1", 1)]));

    chat().send({ kind: "AUDIO", uri: "file:///voice.m4a", durationMs: 4_000 });
    await settle();

    expect(ids(chat())).toEqual(["m1", "local-sub-1"]);

    // The echo beats the HTTP answer (the upload here never finishes).
    emit(
      "chatMessage",
      message("srv-audio", 5, {
        kind: "AUDIO",
        senderId: DRIVER,
        sender: { id: DRIVER, name: "Motorista" },
        client_submission_id: "sub-1",
        attachment_url: "https://storage/voice.m4a?sig=1",
        duration_ms: 4_000,
      }),
    );
    await settle();

    expect(seedChatAudioCache).toHaveBeenCalledWith("srv-audio", "file:///voice.m4a");
    expect(ids(chat())).toEqual(["m1", "srv-audio"]);
  });
});

// ------------------------------------------------- read receipts per ticket
describe("the blue check per ticket (decision 14.5, review round 2)", () => {
  const mine = (id: string, minute: number, ticketId: string) =>
    message(id, minute, { senderId: DRIVER, sender: { id: DRIVER, name: "João" }, ticketId });

  it("turns blue only the ticket the central read, live and after a reload", async () => {
    const { readCursorOf } = await import("@/features/chat/ticket-rules");

    const chat = await openConversation(page([mine("m1", 1, "tk1"), mine("m2", 2, "tk2")]));

    // The central opened ticket #1 only.
    emit("chatRead", { userId: AGENT, last_read_at: at(5), ticketId: "tk1" });
    await settle();

    const [m1, m2] = chat().messages;

    // The thread cursor did not move: #2's message stays unread.
    expect(chat().counterpartReadAt).toBeNull();
    expect(readCursorOf(m1, chat().readCursors)).toBe(at(5));
    expect(readCursorOf(m2, chat().readCursors)).toBeNull();

    // A reload (pull to refresh) brings the cursors from the API, same answer.
    api.get.mockResolvedValueOnce({
      ...page([mine("m1", 1, "tk1"), mine("m2", 2, "tk2")]),
      counterpartTicketReadAt: { tk1: at(6) },
    });
    await chat().refresh();
    await settle();

    expect(readCursorOf(chat().messages[0], chat().readCursors)).toBe(at(6));
    expect(readCursorOf(chat().messages[1], chat().readCursors)).toBeNull();
  });
});
