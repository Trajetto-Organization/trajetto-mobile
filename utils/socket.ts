import { io, type Socket } from "socket.io-client";

import { tokenStorage } from "./storage";
import { shouldRefreshCredential } from "./socket-auth-rules";

let socketInstance: Socket | null = null;
let socketGeneration = 0;

const connectionStatus = {
  isConnected: false,
  isConnecting: false,
  hasConnectionError: false,
  errorMessage: "",
};

const getSocketUrl = (): string => {
  const socketUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "");
  if (!socketUrl) {
    throw new Error("URL do socket nao definida");
  }
  return socketUrl;
};

/**
 * How the socket asks for a fresh access token.
 *
 * Registered by `apiClient` rather than imported from it, because `api.ts`
 * already imports this module. It must stay the app's single refresher: the
 * API rotates refresh tokens and treats a reused one as replay, revoking every
 * session on the account. `apiClient.refreshToken` de-duplicates concurrent
 * calls behind one promise, which is exactly what makes this safe.
 */
let refreshAccessToken: (() => Promise<string | null>) | null = null;

function setSocketTokenRefresher(
  refresher: () => Promise<string | null>,
): void {
  refreshAccessToken = refresher;
}

// Kept so a refresh that already happened can push the new token in without
// waiting for the next handshake.
const setSocketToken = (socket: Socket, token: string): void => {
  socket.auth = {
    ...(typeof socket.auth === "object" ? socket.auth : {}),
    token,
  };
};

const createSocket = (socketUrl: string, token: string): Socket => {
  const generation = ++socketGeneration;
  const socket = io(socketUrl, {
    /**
     * A callback, so every reconnection reads storage again.
     *
     * The object form was only as fresh as the last `setSocketToken` push, and
     * those fire on an HTTP 401 or on returning from background. An app left
     * in the foreground, idle, whose token aged past fifteen minutes and whose
     * connection then flipped (lift, tunnel, mobile→wifi) reconnected forever
     * with the expired token, and no HTTP call was happening to notice.
     */
    auth: (cb: (data: object) => void) => {
      void tokenStorage
        .getAccessToken()
        .then((fresh) => cb({ token: fresh ?? token }))
        .catch(() => cb({ token }));
    },
    autoConnect: false,
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
  });

  socket.on("connect", () => {
    if (generation !== socketGeneration) return;
    connectionStatus.isConnected = true;
    connectionStatus.isConnecting = false;
    connectionStatus.hasConnectionError = false;
    connectionStatus.errorMessage = "";
  });

  socket.on("disconnect", () => {
    if (generation !== socketGeneration) return;
    connectionStatus.isConnected = false;
    connectionStatus.isConnecting = false;
  });

  socket.on("connect_error", (error) => {
    if (generation !== socketGeneration) return;
    connectionStatus.isConnected = false;
    connectionStatus.isConnecting = false;
    connectionStatus.hasConnectionError = true;
    connectionStatus.errorMessage = error.message;

    // Reading the stored token at each attempt is not enough on its own: if
    // the stored one is the expired one, every retry carries it. One refresh,
    // through the single-flight refresher, is what actually breaks the loop.
    if (!shouldRefreshCredential(error)) return;
    if (!refreshAccessToken) return;

    void refreshAccessToken()
      .then((token) => {
        // A null answer means the session is really gone. The auth store is
        // already being told by the same refresh, and it owns the logout.
        if (!token || generation !== socketGeneration) return;
        setSocketToken(socket, token);
      })
      .catch(() => undefined);
  });

  return socket;
};

/**
 * Returns as soon as the socket is configured. Consumers can attach their
 * listeners before the first connection succeeds, so a temporary network
 * failure cannot permanently disable security events.
 */
async function initializeSocket(): Promise<Socket> {
  const token = await tokenStorage.getAccessToken();
  if (!token) {
    throw new Error("Token de autenticacao nao disponivel");
  }

  if (!socketInstance) {
    socketInstance = createSocket(getSocketUrl(), token);
  } else {
    setSocketToken(socketInstance, token);
  }

  return socketInstance;
}

async function updateSocketAuthToken(token?: string): Promise<void> {
  const nextToken = token ?? (await tokenStorage.getAccessToken());
  if (!nextToken || !socketInstance) return;
  setSocketToken(socketInstance, nextToken);
}

async function reconnectSocket(): Promise<Socket> {
  const socket = await initializeSocket();
  if (!socket.connected && !socket.active) {
    connectionStatus.isConnecting = true;
    socket.connect();
  }
  return socket;
}

/** Stops network activity while preserving the singleton and its listeners. */
function pauseSocket(): void {
  if (!socketInstance) return;
  socketInstance.disconnect();
  connectionStatus.isConnected = false;
  connectionStatus.isConnecting = false;
}

function disconnectSocket(notifyServer = true): void {
  const socket = socketInstance;
  if (!socket) return;

  // Detach the singleton immediately so a new login can never reuse a socket
  // authenticated with the previous session.
  socketInstance = null;
  socketGeneration += 1;
  connectionStatus.isConnected = false;
  connectionStatus.isConnecting = false;

  if (notifyServer && socket.connected) {
    socket.emit("client_logout");
    setTimeout(() => socket.disconnect(), 100);
    return;
  }

  socket.disconnect();
}

function isSocketConnected(): boolean {
  return socketInstance?.connected ?? false;
}

function getConnectionStatus() {
  return { ...connectionStatus };
}

function getSocket(): Socket | null {
  return socketInstance;
}

export {
  disconnectSocket,
  getConnectionStatus,
  getSocket,
  initializeSocket,
  isSocketConnected,
  pauseSocket,
  reconnectSocket,
  setSocketTokenRefresher,
  updateSocketAuthToken,
};
