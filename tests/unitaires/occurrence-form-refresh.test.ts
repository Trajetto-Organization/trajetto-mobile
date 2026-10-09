import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryObserver, onlineManager } from "@tanstack/react-query";

import { ApiError } from "@/utils/api-error";
import { formRefreshOf, reviewFormState } from "@/features/occurrences/occurrence-queue-rules";

/**
 * The reread that brings the current form after a refusal, as the report
 * screen shows it — through the real `useFormRefresh`, the app's real
 * QueryClient and react-query's real online manager.
 *
 * Before: the screen showed "Buscando o formulário atual…" until the
 * refetch settled. The app's client pauses a fetch without a network
 * (networkMode "online", the default) and its promise stays pending until
 * the network is back, so a review opened in a dead zone — or a refusal at
 * the tap followed by lost signal — held the send and the type for the
 * whole dead zone, and "Buscar de novo" never appeared.
 */

// ------------------------------------------------ a render, by hand
// The hooks keep their slots across "renders"; useSyncExternalStore reads
// the store at each render (its subscription is tested on the tracker).
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  const slot = <T>(make: () => T): T => {
    const index = hooks.cursor;
    hooks.cursor += 1;

    if (!(index in hooks.slots)) hooks.slots[index] = make();

    return hooks.slots[index] as T;
  };

  return {
    ...actual,
    useRef: <T>(initial: T) => slot(() => ({ current: initial })),
    useState: <T>(initial: T | (() => T)) => [
      slot(() => (typeof initial === "function" ? (initial as () => T)() : initial)),
      () => undefined,
    ],
    useSyncExternalStore: <T>(_subscribe: unknown, getSnapshot: () => T) => getSnapshot(),
  };
});

// ------------------------------------ the QueryClient's platform bindings
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
  Platform: { OS: "android" },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => undefined },
}));

vi.mock("socket.io-client", () => ({ io: () => ({ on() {}, off() {}, connect() {}, disconnect() {} }) }));

vi.mock("@/utils/storage", () => ({
  tokenStorage: { getAccessToken: async () => "token" },
}));

type Hook = typeof import("@/features/occurrences/use-form-refresh");

let useFormRefresh: Hook["useFormRefresh"];
let createFormRefreshTracker: Hook["createFormRefreshTracker"];
let queryClient: typeof import("@/providers/query-provider").queryClient;

beforeAll(async () => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  ({ useFormRefresh, createFormRefreshTracker } = await import(
    "@/features/occurrences/use-form-refresh"
  ));
  ({ queryClient } = await import("@/providers/query-provider"));

  // What QueryClientProvider does on mount: subscribes to focus and online.
  queryClient.mount();
});

afterAll(() => {
  queryClient.unmount();
});

const KEY = ["my-deliveries", "business-1"];
const DAY = { data: [], occurrence_types: [] };

let fetches = 0;
let answer: () => Promise<unknown> = async () => DAY;
let stopObserving: () => void = () => undefined;
let observer: QueryObserver<unknown, Error>;

beforeEach(() => {
  hooks.slots = [];
  fetches = 0;
  answer = async () => DAY;

  onlineManager.setOnline(true);
  queryClient.clear();

  // The screen's list: fresh, so mounting does not fetch by itself.
  queryClient.setQueryData(KEY, DAY);
  observer = new QueryObserver<unknown, Error>(queryClient, {
    queryKey: KEY,
    queryFn: () => {
      fetches += 1;
      return answer();
    },
  });
  stopObserving = observer.subscribe(() => undefined);
});

afterEach(() => {
  stopObserving();
  onlineManager.setOnline(true);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const settle = async () => {
  for (let tick = 0; tick < 20; tick += 1) await flush();
};

/** One render of the screen's hook, as the screen calls it. */
function render(listLoading = false) {
  hooks.cursor = 0;

  return useFormRefresh({ refetch: () => observer.refetch(), listLoading });
}

const OFFLINE_NOTICE =
  "Sem conexão para buscar o formulário atual. Você pode enviar assim: o registro fica salvo no aparelho e, se o formulário tiver mudado, volta para revisão. A busca continua quando a conexão voltar.";

describe("the current form after a refusal, without signal", () => {
  it("is shown as offline, not as a fetch that never ends, and the driver can send", async () => {
    onlineManager.setOnline(false);

    expect(render().refresh).toBe("idle");

    render().request();
    await settle();

    // The premise: react-query paused the fetch, and nothing settled it.
    expect(queryClient.getQueryState(KEY)?.fetchStatus).toBe("paused");
    expect(fetches).toBe(0);

    const { refresh } = render();

    expect(refresh).toBe("offline");
    expect(reviewFormState({ reason: "form-outdated", typeListed: true, refresh })).toEqual({
      typeLocked: true,
      canSend: true,
      notice: OFFLINE_NOTICE,
    });

    // A new report refused at the tap is not held either.
    expect(reviewFormState({ reason: null, typeListed: true, refresh }).canSend).toBe(true);
  });

  it("back online, the paused fetch resumes by itself and the form is current", async () => {
    onlineManager.setOnline(false);

    render().request();
    await settle();

    expect(render().refresh).toBe("offline");

    onlineManager.setOnline(true);
    await settle();

    expect(fetches).toBe(1);
    expect(render().refresh).toBe("done");
    expect(
      reviewFormState({ reason: "form-outdated", typeListed: true, refresh: render().refresh }),
    ).toEqual({ typeLocked: true, canSend: true, notice: null });
  });

  it("signal lost while the reread is underway: offline at once, done when it lands", async () => {
    let land: (value: unknown) => void = () => undefined;
    answer = () => new Promise((resolve) => (land = resolve));

    render().request();
    await settle();

    expect(render().refresh).toBe("loading");

    onlineManager.setOnline(false);

    expect(render().refresh).toBe("offline");

    land(DAY);
    await settle();

    expect(render().refresh).toBe("done");
  });

  it("the first load of the day waits for the network the same way", () => {
    onlineManager.setOnline(false);

    expect(render(true).refresh).toBe("offline");

    onlineManager.setOnline(true);

    expect(render(true).refresh).toBe("loading");
  });
});

describe("the current form after a refusal, with signal", () => {
  it("waits while the reread is underway, then sends with the current form", async () => {
    let land: (value: unknown) => void = () => undefined;
    answer = () => new Promise((resolve) => (land = resolve));

    render().request();
    await settle();

    expect(render().refresh).toBe("loading");
    expect(
      reviewFormState({ reason: "form-outdated", typeListed: true, refresh: render().refresh })
        .canSend,
    ).toBe(false);

    land(DAY);
    await settle();

    expect(render().refresh).toBe("done");
  });

  it("a reread the API refuses says so, and offers to try again", async () => {
    answer = async () => {
      throw new ApiError("Recusado.", 422, "Unprocessable", "HTTP", "SOMETHING");
    };

    render().request();
    await settle();

    expect(render().refresh).toBe("failed");
  });
});

describe("the tracker", () => {
  it("only the latest request speaks: an older one settling late changes nothing", async () => {
    const lands: Array<(value: { isError: boolean }) => void> = [];
    const tracker = createFormRefreshTracker(
      () => new Promise((resolve) => lands.push(resolve)),
    );

    tracker.request();
    tracker.request();

    lands[1]({ isError: false });
    await flush();
    lands[0]({ isError: true });
    await flush();

    expect(tracker.current()).toBe("done");
  });

  it("tells the screen each change", async () => {
    let land: (value: { isError: boolean }) => void = () => undefined;
    const tracker = createFormRefreshTracker(() => new Promise((resolve) => (land = resolve)));
    const seen: string[] = [];

    const stop = tracker.subscribe(() => seen.push(tracker.current()));

    tracker.request();
    land({ isError: true });
    await flush();

    stop();
    tracker.request();

    expect(seen).toEqual(["loading", "failed"]);
  });
});

describe("what the screen shows", () => {
  it("offline only while something is underway: a settled reread keeps its word", () => {
    expect(formRefreshOf({ requested: "loading", listLoading: false, online: false })).toBe(
      "offline",
    );
    expect(formRefreshOf({ requested: "idle", listLoading: true, online: false })).toBe(
      "offline",
    );
    expect(formRefreshOf({ requested: "done", listLoading: false, online: false })).toBe("done");
    expect(formRefreshOf({ requested: "failed", listLoading: false, online: false })).toBe(
      "failed",
    );
    expect(formRefreshOf({ requested: "idle", listLoading: false, online: false })).toBe("idle");
    expect(formRefreshOf({ requested: "failed", listLoading: true, online: true })).toBe(
      "loading",
    );
  });
});
