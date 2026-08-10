import { io, type Socket } from "socket.io-client";

import { tokenStorage } from "./storage";

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

const setSocketToken = (socket: Socket, token: string): void => {
  socket.auth = {
    ...(typeof socket.auth === "object" ? socket.auth : {}),
    token,
  };
};

const createSocket = (socketUrl: string, token: string): Socket => {
  const generation = ++socketGeneration;
  const socket = io(socketUrl, {
    auth: { token },
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
  updateSocketAuthToken,
};
