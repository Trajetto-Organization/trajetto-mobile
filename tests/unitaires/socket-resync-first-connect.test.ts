import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A socket whose FIRST connection only came after failed attempts.
 *
 * The resync skips a socket's first connection: the lists were just fetched
 * when the app opened. That holds only when the socket came up right behind
 * them. A driver who opens the app during a deploy has the handshake refused
 * and retried with a backoff of up to a minute, while `my-deliveries` sits
 * fresh for five minutes. A stop reassigned in that window is emitted to
 * nobody, and the first `connect` that finally arrives is the only moment
 * the list can catch up.
 *
 * The expired token of a cold start is the exception: one refresh and an
 * immediate retry, no gap worth a second fetch of every list.
 *
 * A real Socket.IO server, borrowed from the API's own dependencies.
 */
vi.mock("@/utils/storage", () => ({
  tokenStorage: { getAccessToken: async () => "valid-token" },
}));

const API_SOCKET_IO = resolve(process.cwd(), "..", "trajetto-api", "node_modules", "socket.io");
const hasServer = existsSync(API_SOCKET_IO);

let http: HttpServer;
let refuseNext: string | null = null;

let socketModule: typeof import("@/utils/socket");

type Middleware = (socket: unknown, next: (error?: Error) => void) => void;

type SocketServer = new (
  http: HttpServer,
  options: unknown,
) => { use(middleware: Middleware): void };

beforeAll(async () => {
  if (!hasServer) return;

  const { Server } = createRequire(__filename)(API_SOCKET_IO) as {
    Server: SocketServer;
  };

  http = createServer();
  const io = new Server(http, { transports: ["websocket"] });

  io.use((_socket, next) => {
    if (refuseNext) {
      const code = refuseNext;
      refuseNext = null;
      return next(Object.assign(new Error("recusado"), { data: { code } }));
    }

    next();
  });

  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));

  process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  socketModule = await import("@/utils/socket");
});

afterEach(() => {
  refuseNext = null;
  socketModule?.disconnectSocket(false);
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (hasServer) await new Promise<void>((done) => http.close(() => done()));
});

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function until(condition: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(25);
  }

  return condition();
}

describe.skipIf(!hasServer)("a first connection that only came after a refusal", () => {
  it("asks the app to reconcile once, like a reconnection", async () => {
    // No jitter: the refusal retry waits 500 ms and the resync fires at once.
    vi.spyOn(Math, "random").mockReturnValue(0);

    const resync = vi.fn();
    const stop = socketModule.onRealtimeResync(resync);

    refuseNext = "SOCKET_UNAVAILABLE";
    await socketModule.reconnectSocket();

    expect(
      await until(() => socketModule.isSocketConnected(), 4_000),
      "o socket não conectou depois da recusa",
    ).toBe(true);

    expect(
      await until(() => resync.mock.calls.length > 0, 2_000),
      "a lista do motorista ficou com o que foi buscado antes da recusa",
    ).toBe(true);

    await sleep(150);
    expect(resync).toHaveBeenCalledTimes(1);

    stop();
  });

  it("does not refetch everything for an expired token fixed by one refresh", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    socketModule.setSocketTokenRefresher(async () => "fresh-token");

    const resync = vi.fn();
    const stop = socketModule.onRealtimeResync(resync);

    refuseNext = "AUTH_TOKEN_INVALID";
    await socketModule.reconnectSocket();

    expect(
      await until(() => socketModule.isSocketConnected(), 4_000),
      "o socket não conectou depois do refresh",
    ).toBe(true);

    await sleep(150);
    expect(resync).not.toHaveBeenCalled();

    stop();
  });
});
