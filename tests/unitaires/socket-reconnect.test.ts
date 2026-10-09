import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { refusalRetryDelay } from "@/utils/socket-auth-rules";

/**
 * The driver's socket after the server says no.
 *
 * socket.io-client retries a dropped transport by itself, but a refusal from
 * the server's handshake middleware ends the socket — and the app never called
 * `connect()` again. A refresh after an expired token, a rate-limited
 * handshake during a deploy, a database blink mid-handshake: every one left
 * the app without realtime until it went to the background and back. And the
 * token each HTTP refresh pushed in replaced the `auth` callback with a static
 * object, so the next handshake carried whatever that object held.
 *
 * A real Socket.IO server, borrowed from the API's own dependencies (this app
 * has no business shipping one), refusing the first handshake of each test.
 */
let storedToken = "expired-token";

vi.mock("@/utils/storage", () => ({
  tokenStorage: { getAccessToken: async () => storedToken },
}));

const API_SOCKET_IO = resolve(process.cwd(), "..", "trajetto-api", "node_modules", "socket.io");
const hasServer = existsSync(API_SOCKET_IO);

let http: HttpServer;
let refuseNext: { message: string; code: string } | null = null;
const tokensSeen: string[] = [];

let socketModule: typeof import("@/utils/socket");

/** The slice of socket.io's server this test touches (the package is the API's). */
interface HandshakeSocket {
  handshake: { auth?: Record<string, unknown> };
}

type Middleware = (socket: HandshakeSocket, next: (error?: Error) => void) => void;

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

  io.use((socket, next) => {
    tokensSeen.push(String(socket.handshake.auth?.token));

    if (refuseNext) {
      const error = Object.assign(new Error(refuseNext.message), {
        data: { code: refuseNext.code },
      });
      refuseNext = null;
      return next(error);
    }

    next();
  });

  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));

  process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  socketModule = await import("@/utils/socket");
});

afterEach(() => {
  socketModule?.disconnectSocket(false);
  tokensSeen.length = 0;
});

afterAll(async () => {
  if (hasServer) await new Promise<void>((done) => http.close(() => done()));
});

async function connectedWithin(ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (socketModule.isSocketConnected()) return true;
    await new Promise((done) => setTimeout(done, 50));
  }

  return false;
}

describe.skipIf(!hasServer)("a handshake refused for an expired token", () => {
  it("refreshes, and connects again with the fresh token", async () => {
    storedToken = "expired-token";
    refuseNext = { message: "Token expirado", code: "AUTH_TOKEN_INVALID" };

    socketModule.setSocketTokenRefresher(async () => {
      storedToken = "fresh-token";
      return "fresh-token";
    });

    await socketModule.reconnectSocket();

    expect(await connectedWithin(3_000), "o socket não voltou depois do refresh").toBe(true);
    expect(tokensSeen.at(-1)).toBe("fresh-token");
  });
});

describe.skipIf(!hasServer)("a handshake refused for anything else", () => {
  it("tries again on its own, after a pause", async () => {
    storedToken = "valid-token";
    refuseNext = { message: "Muitas tentativas", code: "SOCKET_RATE_LIMITED" };

    await socketModule.reconnectSocket();

    // The first retry waits 0.5–1.5 s.
    expect(await connectedWithin(4_000), "o socket desistiu depois da recusa").toBe(true);
    expect(tokensSeen).toHaveLength(2);
  });
});

describe.skipIf(!hasServer)("a token pushed in from outside", () => {
  it("does not replace the callback that reads storage", async () => {
    storedToken = "valid-token";

    const socket = await socketModule.initializeSocket();
    await socketModule.updateSocketAuthToken("pushed-token");

    expect(typeof socket.auth).toBe("function");
  });
});

describe("the pause after a refusal", () => {
  it("doubles from a second to a minute, with jitter either side", () => {
    expect(refusalRetryDelay(0, () => 0)).toBe(500);
    expect(refusalRetryDelay(0, () => 0.999999)).toBeLessThanOrEqual(1_500);
    expect(refusalRetryDelay(3, () => 0.5)).toBe(8_000);

    // A fleet refused together must not come back together, nor wait forever.
    expect(refusalRetryDelay(20, () => 0.5)).toBe(60_000);
    expect(refusalRetryDelay(20, () => 0.999999)).toBeLessThanOrEqual(90_000);
  });
});
