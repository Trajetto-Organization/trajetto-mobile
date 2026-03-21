import { io, Socket } from "socket.io-client";
import { tokenStorage } from "./storage";

// Singleton instance
let socketInstance: Socket | null = null;
let connectionPromise: Promise<Socket> | null = null;

// Connection status
const connectionStatus = {
  isConnected: false,
  isConnecting: false,
  hasConnectionError: false,
  errorMessage: "",
};

// Initialize the socket with authentication
async function initializeSocket(): Promise<Socket> {
  // If already initializing, return the existing promise
  if (connectionPromise) return connectionPromise;

  // If already connected, return the existing instance
  if (socketInstance && socketInstance.connected) return socketInstance;

  connectionPromise = new Promise<Socket>(async (resolve, reject) => {
    try {
      connectionStatus.isConnecting = true;

      // Get the authentication token from secure storage
      const token = await tokenStorage.getAccessToken();

      if (!token) {
        throw new Error("Token de autenticação não disponível");
      }

      const socketUrl = process.env.EXPO_PUBLIC_API_URL;

      if (!socketUrl) {
        throw new Error("URL do socket não definida");
      }

      // Create socket instance.
      // transports: ["websocket"] is REQUIRED for React Native —
      // long-polling does not work reliably in the RN environment.
      const socket = io(socketUrl, {
        auth: { token },
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      socket.on("connect", () => {
        connectionStatus.isConnected = true;
        connectionStatus.isConnecting = false;

        connectionStatus.hasConnectionError = false;
        connectionStatus.errorMessage = "";

        resolve(socket);
      });

      socket.on("disconnect", () => {
        connectionStatus.isConnected = false;
      });

      socket.on("connect_error", (error) => {
        connectionStatus.isConnected = false;

        connectionStatus.hasConnectionError = true;
        connectionStatus.errorMessage = error.message;

        reject(error);
      });

      socket.connect();

      // Store the instance immediately so it can be referenced in disconnectSocket
      socketInstance = socket;

      // Safety timeout
      setTimeout(() => {
        if (!socket.connected) {
          reject(new Error("Timeout ao conectar ao socket"));
        }
      }, 10000);
    } catch (error) {
      connectionStatus.isConnecting = false;

      connectionStatus.hasConnectionError = true;
      connectionStatus.errorMessage =
        error instanceof Error ? error.message : "Erro desconhecido";

      reject(error);
    }
  });

  // Clean up promise after it resolves or rejects
  connectionPromise
    .catch(() => {})
    .finally(() => {
      connectionStatus.isConnecting = false;
      connectionPromise = null;
    });

  return connectionPromise;
}

// Terminate the connection gracefully
function disconnectSocket(): void {
  if (socketInstance) {
    try {
      // Emit client_logout so the server knows this is intentional
      // (not a network drop) and cleans up the room/session
      socketInstance.emit("client_logout");

      // Short delay to ensure the event is processed before disconnecting
      setTimeout(() => {
        if (socketInstance) {
          socketInstance.disconnect();
          socketInstance = null;
        }
      }, 100);
    } catch {
      // Fallback: force disconnect immediately if emit fails
      if (socketInstance) {
        socketInstance.disconnect();
        socketInstance = null;
      }
    }
  }

  connectionPromise = null;

  connectionStatus.isConnected = false;
  connectionStatus.isConnecting = false;
}

function isSocketConnected(): boolean {
  return socketInstance?.connected || false;
}

function getConnectionStatus() {
  return { ...connectionStatus };
}

function getSocket(): Socket | null {
  return socketInstance;
}

export {
  initializeSocket,
  disconnectSocket,
  isSocketConnected,
  getConnectionStatus,
  getSocket,
};
