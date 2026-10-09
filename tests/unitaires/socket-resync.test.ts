import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The driver's socket coming back after the server dropped it.
 *
 * The API has no replay: a route released or a stop reassigned while the
 * phone was reconnecting — a deploy, a tunnel — is emitted once, to nobody.
 * Only the chat asked the server again on `connect`. The route and the
 * delivery list waited for the next focus change, network change or pull to
 * refresh, so a driver looking at the screen kept the old list.
 *
 * What is pinned here is the signal the app reconciles on: once per
 * reconnection of the same socket, never on a socket's first connection.
 *
 * A real Socket.IO server, borrowed from the API's own dependencies.
 */
vi.mock("@/utils/storage", () => ({
  tokenStorage: { getAccessToken: async () => "valid-token" },
}));

const API_SOCKET_IO = resolve(process.cwd(), "..", "trajetto-api", "node_modules", "socket.io");
const hasServer = existsSync(API_SOCKET_IO);

let http: HttpServer;

/** The server side of every connection, newest last. */
const serverSockets: Array<{ conn: { close(): void } }> = [];

let socketModule: typeof import("@/utils/socket");

type SocketServer = new (
  http: HttpServer,
  options: unknown,
) => {
  on(event: "connection", listener: (socket: { conn: { close(): void } }) => void): void;
};

beforeAll(async () => {
  if (!hasServer) return;

  const { Server } = createRequire(__filename)(API_SOCKET_IO) as {
    Server: SocketServer;
  };

  http = createServer();
  const io = new Server(http, { transports: ["websocket"] });

  io.on("connection", (socket) => serverSockets.push(socket));

  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));

  process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  socketModule = await import("@/utils/socket");
});

afterEach(() => {
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

async function connected(): Promise<void> {
  await socketModule.reconnectSocket();
  await until(() => socketModule.isSocketConnected(), 3_000);
}

async function dropTransport(): Promise<boolean> {
  const before = serverSockets.length;
  serverSockets.at(-1)?.conn.close();

  return until(
    () => serverSockets.length > before && socketModule.isSocketConnected(),
    5_000,
  );
}

describe.skipIf(!hasServer)("a reconnection after the server dropped the transport", () => {
  it("asks the app to reconcile once, and not on the first connection", async () => {
    // No jitter and no backoff randomisation: the test is about WHETHER the
    // resync fires, the spread is a detail of when.
    vi.spyOn(Math, "random").mockReturnValue(0);

    const resync = vi.fn();
    const stop = socketModule.onRealtimeResync(resync);

    await connected();
    await sleep(150);

    expect(resync, "a primeira conexão não perdeu nada").not.toHaveBeenCalled();

    expect(await dropTransport(), "o socket não reconectou").toBe(true);

    expect(
      await until(() => resync.mock.calls.length > 0, 3_000),
      "a lista do motorista não foi avisada de que perdeu eventos",
    ).toBe(true);

    await sleep(150);
    expect(resync).toHaveBeenCalledTimes(1);

    stop();
  });

  it("does not resync the first connection of a new session", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    await connected();

    // Logout and login again: a new socket generation.
    socketModule.disconnectSocket(false);

    const resync = vi.fn();
    const stop = socketModule.onRealtimeResync(resync);

    await connected();
    await sleep(150);

    expect(resync).not.toHaveBeenCalled();

    stop();
  });

  it("reconciles after a return from background too", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    await connected();

    const resync = vi.fn();
    const stop = socketModule.onRealtimeResync(resync);

    // What the socket provider does on AppState background → active.
    socketModule.pauseSocket();
    await sleep(50);
    await connected();

    expect(await until(() => resync.mock.calls.length > 0, 3_000)).toBe(true);
    expect(resync).toHaveBeenCalledTimes(1);

    stop();
  });

  it("stops calling a listener that unsubscribed", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const gone = vi.fn();
    const stay = vi.fn();

    socketModule.onRealtimeResync(gone)();
    const stop = socketModule.onRealtimeResync(stay);

    await connected();
    await dropTransport();
    await until(() => stay.mock.calls.length > 0, 3_000);

    expect(stay).toHaveBeenCalledTimes(1);
    expect(gone).not.toHaveBeenCalled();

    stop();
  });
});
