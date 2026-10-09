import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ENTITLEMENTS_CHANGED_EVENT,
  bindAccessEvents,
  rereadWithTrailing,
} from "@/features/access/access-events";

/**
 * A module switched on or off in the panel reaches the phone at once (MOB-11).
 *
 * The API emits `entitlementsChanged` to every login of the company; the app
 * did not listen, so tabs, card actions and parked submissions only changed
 * on the next return to the foreground. This runs the real SocketProvider's
 * effect — hooks captured by hand, as in route-realtime-resync.test.ts — over
 * a fake socket, emits the event, and checks that the session re-reads
 * `/user/me` and takes the new plan.
 */

type Listener = (...args: unknown[]) => unknown;

class FakeSocket {
  connected = true;
  active = true;
  listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  connect() {}

  async emit(event: string, payload?: unknown) {
    await Promise.all(
      [...(this.listeners.get(event) ?? [])].map((listener) => listener(payload)),
    );
  }

  count(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

const socket = new FakeSocket();

let effects: Array<() => void | (() => void)> = [];

vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    effects.push(effect);
  },
  useRef: <T>(value: T) => ({ current: value }),
}));

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

const toasts = vi.hoisted(() => [] as Array<{ text1?: string; text2?: string }>);

vi.mock("react-native-toast-message", () => ({
  default: { show: (toast: { text1?: string; text2?: string }) => toasts.push(toast) },
}));

const setServerUser = vi.fn();
const logout = vi.fn(async () => undefined);

vi.mock("@/store/auth-store", () => {
  const state = {
    isAuthenticated: true,
    logout: () => logout(),
    setServerUser: (user: unknown) => setServerUser(user),
  };

  const useAuthStore = (select: (s: typeof state) => unknown) => select(state);
  useAuthStore.getState = () => state;

  return { useAuthStore };
});

const get = vi.fn();

vi.mock("@/utils/api", async () => {
  const { ApiError } =
    await vi.importActual<typeof import("@/utils/api-error")>(
      "@/utils/api-error",
    );

  return { ApiError, apiClient: { get: (path: string) => get(path) } };
});

vi.mock("@/utils/socket", () => ({
  disconnectSocket: () => undefined,
  initializeSocket: async () => socket,
  backgroundSocket: () => undefined,
  foregroundSocket: async () => socket,
}));

let SocketProvider: (props: { children?: unknown }) => unknown;

beforeAll(async () => {
  // The provider's JSX compiles to React.createElement; only its effects
  // matter here.
  vi.stubGlobal("React", {
    createElement: () => null,
    Fragment: "Fragment",
  });

  ({ SocketProvider } = (await import("@/providers/socket-provider")) as never);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountProvider(): Promise<() => void> {
  effects = [];
  SocketProvider({ children: null });

  const cleanups = effects.map((effect) => effect());
  await flush();

  return () => cleanups.forEach((cleanup) => cleanup?.());
}

beforeEach(() => {
  socket.listeners.clear();
  setServerUser.mockReset();
  logout.mockReset();
  get.mockReset();
  toasts.length = 0;
});

describe("a module switched on or off in the panel", () => {
  it("makes the session re-read /user/me and take the new plan", async () => {
    const unmount = await mountProvider();

    const driver = {
      id: "u1",
      role: "BUSINESS_USER",
      driverId: "d1",
      businessId: "b1",
      enabledModules: ["DELIVERIES"],
    };
    get.mockResolvedValue({ message: "ok", user: driver });

    await socket.emit(ENTITLEMENTS_CHANGED_EVENT, {
      module: "FLEET",
      enabled: false,
    });
    // The socket does not wait for the re-read.
    await flush();

    expect(get).toHaveBeenCalledWith("/user/me");
    expect(setServerUser).toHaveBeenCalledWith(driver);

    // A plan change is not a reason to end the session.
    expect(logout).not.toHaveBeenCalled();

    unmount();
  });

  it("is not lost when it arrives while an earlier re-read is on its way", async () => {
    // The first read left before the second change reached the server and
    // answers with the plan in between. Joining it kept that stale plan
    // until the next foreground.
    const unmount = await mountProvider();

    const user = (enabledModules: string[]) => ({
      id: "u1",
      role: "BUSINESS_USER",
      driverId: "d1",
      businessId: "b1",
      enabledModules,
    });

    let answerFirst: (value: unknown) => void = () => undefined;
    get.mockImplementationOnce(
      () => new Promise((resolve) => (answerFirst = resolve)),
    );
    get.mockResolvedValueOnce({ message: "ok", user: user(["DELIVERIES"]) });

    await socket.emit(ENTITLEMENTS_CHANGED_EVENT, { module: "FLEET", enabled: true });
    await flush();

    await socket.emit(ENTITLEMENTS_CHANGED_EVENT, { module: "FLEET", enabled: false });
    await flush();

    // Still one request out: events during a read do not stack requests.
    expect(get).toHaveBeenCalledTimes(1);

    answerFirst({ message: "ok", user: user(["FLEET", "DELIVERIES"]) });
    await flush();

    // One more read after it, and the session ends on the newest plan.
    expect(get).toHaveBeenCalledTimes(2);
    expect(setServerUser).toHaveBeenLastCalledWith(user(["DELIVERIES"]));

    unmount();
  });

  it("stops being listened to when the session's socket effect ends", async () => {
    const unmount = await mountProvider();

    expect(socket.count(ENTITLEMENTS_CHANGED_EVENT)).toBe(1);

    unmount();

    expect(socket.count(ENTITLEMENTS_CHANGED_EVENT)).toBe(0);
  });
});

describe("the re-read runner", () => {
  it("runs one more read for any number of calls during a read, and settles them all after it", async () => {
    const releases: Array<() => void> = [];
    const task = vi.fn(
      () => new Promise<void>((resolve) => releases.push(resolve)),
    );

    const reread = rereadWithTrailing(task);

    const calls = [reread()];
    await flush();
    expect(task).toHaveBeenCalledTimes(1);

    // Three changes while that read is out.
    calls.push(reread(), reread(), reread());
    await flush();
    expect(task).toHaveBeenCalledTimes(1);

    let settled = false;
    void Promise.all(calls).then(() => (settled = true));

    releases[0]();
    await flush();

    // The trailing read, and only one.
    expect(task).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);

    releases[1]();
    await flush();

    expect(settled).toBe(true);
    expect(task).toHaveBeenCalledTimes(2);

    // Idle again: the next call is a fresh read.
    const next = reread();
    await flush();
    expect(task).toHaveBeenCalledTimes(3);
    releases[2]();
    await next;
  });

  it("does not repeat a read nobody asked for again", async () => {
    const task = vi.fn(async () => undefined);
    const reread = rereadWithTrailing(task);

    await reread();
    await reread();

    expect(task).toHaveBeenCalledTimes(2);

    // Calls made before the read even started are answered by it.
    await Promise.all([reread(), reread()]);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("recovers after a read that threw", async () => {
    let fail = true;
    const task = vi.fn(async () => {
      if (fail) throw new Error("offline");
    });
    const reread = rereadWithTrailing(task);

    await expect(reread()).rejects.toThrow("offline");

    fail = false;
    await expect(reread()).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe("the binding", () => {
  it("routes every plan change to the re-read, and unbinds cleanly", async () => {
    const reread = vi.fn(async () => undefined);
    const source = new FakeSocket();

    const unbind = bindAccessEvents(source, reread);

    await source.emit(ENTITLEMENTS_CHANGED_EVENT, { module: "FLEET", enabled: true });
    await source.emit(ENTITLEMENTS_CHANGED_EVENT, { module: "DELIVERIES", enabled: false });

    expect(reread).toHaveBeenCalledTimes(2);

    unbind();
    await source.emit(ENTITLEMENTS_CHANGED_EVENT, {});

    expect(reread).toHaveBeenCalledTimes(2);
  });

  it("does not let a failing re-read escape into the socket", async () => {
    const source = new FakeSocket();

    bindAccessEvents(source, async () => {
      throw new Error("offline");
    });

    // Resolves (no rejection), and vitest would flag an unhandled one.
    await expect(source.emit(ENTITLEMENTS_CHANGED_EVENT)).resolves.toBeUndefined();
    await flush();
  });
});

/**
 * A refused `/user/me` says why (decision 4.1).
 *
 * The session re-check turned every 403 into "access_denied": a driver whose
 * company was switched off read "Sua conta foi excluída ou não está
 * autorizada". The API's code says which refusal it is; the provider now
 * ends the session with that reason's words.
 */
const { ApiError: RealApiError } = await import("@/utils/api-error");
const { ACCESS_NOTICES, REASON_BY_REFUSAL_CODE, refusalReason } = await import(
  "@/features/access/access-messages"
);

describe("the session re-check refused by the API", () => {

  async function refusedWith(code: string | undefined) {
    const unmount = await mountProvider();

    get.mockRejectedValue(
      new RealApiError("Recusado", 403, "Forbidden", "HTTP", code),
    );

    await socket.emit(ENTITLEMENTS_CHANGED_EVENT, {});
    await flush();

    unmount();

    return toasts.at(-1);
  }

  it.each([
    ["AUTH_BUSINESS_INACTIVE", "A empresa está desativada. Entre em contato com o administrador."],
    ["TENANT_INACTIVE", "A empresa está desativada. Entre em contato com o administrador."],
    ["AUTH_BRANCH_INACTIVE", "A filial do seu cadastro de motorista está desativada. Entre em contato com o administrador."],
    ["AUTH_ACCESS_REVOKED", "Seu acesso foi revogado. Entre em contato com o administrador."],
    ["AUTH_DRIVER_INACTIVE", "Seu cadastro como motorista está inativo. Entre em contato com o administrador."],
  ])("names a %s refusal for what it is", async (code, message) => {
    const toast = await refusedWith(code);

    expect(logout).toHaveBeenCalled();
    expect(toast?.text1).toBe("Acesso encerrado");
    expect(toast?.text2).toBe(message);
    expect(toast?.text2).not.toBe(ACCESS_NOTICES.access_denied.message);
  });

  it("keeps 'access denied' for a refusal it has no code for", async () => {
    const toast = await refusedWith(undefined);

    expect(toast?.text2).toBe(ACCESS_NOTICES.access_denied.message);
  });

  it("has words for every reason a refusal code maps to, and ignores Object's keys", () => {
    for (const reason of Object.values(REASON_BY_REFUSAL_CODE)) {
      expect(Object.prototype.hasOwnProperty.call(ACCESS_NOTICES, reason), reason).toBe(true);
    }

    expect(refusalReason("constructor")).toBe("access_denied");
    expect(refusalReason("PERMISSION_DENIED")).toBe("access_denied");
  });
});
