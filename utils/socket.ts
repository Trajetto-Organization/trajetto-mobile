import { io, type Socket } from "socket.io-client";

import { tokenStorage } from "./storage";
import { isReleaseBundle, releaseApiUrlProblem } from "./api-url-rules";
import {
  refusalRetryDelay,
  shouldRefreshCredential,
  socketErrorCode,
} from "./socket-auth-rules";
import { reportEvent } from "./telemetry";

import {
  RETURN_RESYNC_FALLBACK_MS,
  SOCKET_BACKGROUND_GRACE_MS,
  socketCarriedAbsence,
} from "../features/foreground/return-rules";

let socketInstance: Socket | null = null;
let socketGeneration = 0;

/**
 * The latest token handed to the socket from outside (a refresh, a return
 * from background). Read by the `auth` callback; never written INTO
 * `socket.auth`, which is the callback itself.
 */
let pushedToken: string | null = null;

/** The pending retry after a refused handshake, and how many came before it. */
let refusalRetry: ReturnType<typeof setTimeout> | null = null;
let refusalAttempts = 0;

function cancelRefusalRetry(): void {
  if (refusalRetry) clearTimeout(refusalRetry);
  refusalRetry = null;
}

/**
 * Reconciliation after a reconnection.
 *
 * The API has no replay: a route released or a stop reassigned while the
 * phone was reconnecting (a deploy, a tunnel, a lift) is emitted once, to
 * nobody. The chat already asked the server again on every `connect`; the
 * route and delivery lists waited for the next focus change, network change
 * or pull to refresh, and a driver looking at the screen kept the old list.
 *
 * Every connection after a socket's first (and a first one that only came
 * after a gap) is announced here and the lists refetch. The event stays a
 * hint; the server stays the truth.
 *
 * Spread over a couple of seconds so a deploy that reconnects the whole fleet
 * at once does not become the whole fleet refetching in the same instant.
 */
const RESYNC_JITTER_MS = 2_000;

const resyncListeners = new Set<() => void>();
let pendingResync: ReturnType<typeof setTimeout> | null = null;

function cancelResync(): void {
  if (pendingResync) clearTimeout(pendingResync);
  pendingResync = null;
}

function announceResync(): void {
  [...resyncListeners].forEach((listener) => {
    try {
      listener();
    } catch {
      // One broken consumer must not keep the others stale.
    }
  });
}

function scheduleResync(): void {
  // A flapping connection reconnects several times in a few seconds; the
  // lists refetch everything anyway, so one pending resync covers them all.
  if (pendingResync) return;

  pendingResync = setTimeout(() => {
    pendingResync = null;
    announceResync();
  }, Math.random() * RESYNC_JITTER_MS);
}

/**
 * The app in the background, and what that costs (MOB-20; the rules and
 * their reasons are in `features/foreground/return-rules.ts`).
 *
 * - `leftForegroundAt`: when the app last left the foreground.
 * - `pendingPause`: the pause waiting out the background grace. A return
 *   inside it finds the socket still connected: no handshake, no resync.
 * - `liveSince`: since when the current connection has been up.
 * - `pausedAt`: the socket was paused and has not connected since, so the
 *   realtime lists are owed a resync (and skip their focus refetch).
 * - `returnFallback`: releases them over HTTP if the reconnection is late.
 */
let leftForegroundAt: number | null = null;
let pendingPause: ReturnType<typeof setTimeout> | null = null;
let liveSince: number | null = null;
let pausedAt: number | null = null;
let returnFallback: ReturnType<typeof setTimeout> | null = null;

function cancelPendingPause(): void {
  if (pendingPause) clearTimeout(pendingPause);
  pendingPause = null;
}

function cancelReturnFallback(): void {
  if (returnFallback) clearTimeout(returnFallback);
  returnFallback = null;
}

function armReturnFallback(): void {
  if (returnFallback) return;

  returnFallback = setTimeout(() => {
    returnFallback = null;

    // Connected meanwhile: that connection's own resync covers it.
    if (pausedAt === null) return;

    // The lists skipped their focus refetch for this resync; they are not
    // left waiting on a socket that may not come back. Its connection, when
    // it does come, is announced as usual.
    pausedAt = null;
    announceResync();
  }, RETURN_RESYNC_FALLBACK_MS);
}

/**
 * Runs `listener` after every reconnection. Not on a socket's first
 * connection, unless that one only came after failed attempts. Returns the
 * unsubscribe, so it fits straight into a `useEffect`. Independent of the socket instance: it survives a logout and
 * the next login.
 */
function onRealtimeResync(listener: () => void): () => void {
  resyncListeners.add(listener);

  return () => {
    resyncListeners.delete(listener);
  };
}

const connectionStatus = {
  isConnected: false,
  isConnecting: false,
  hasConnectionError: false,
  errorMessage: "",
};

const getSocketUrl = (): string => {
  const socketUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "");
  if (!socketUrl) {
    throw new Error("URL do socket não definida");
  }

  // The same refusal as the HTTP client: an OTA bundle published with a LAN
  // or cleartext URL must not hand the driver's token to it.
  const refusal = isReleaseBundle() ? releaseApiUrlProblem(socketUrl) : null;
  if (refusal) throw new Error(refusal);

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
//
// It used to REPLACE `socket.auth` with `{ token }`, and `socket.auth` is the
// callback below: the first push — every HTTP refresh does one — turned the
// socket back into the static credential the callback exists to avoid.
const setSocketToken = (token: string): void => {
  pushedToken = token;
};

const createSocket = (socketUrl: string, token: string): Socket => {
  const generation = ++socketGeneration;

  // Per generation: a new login builds a new socket, and its first
  // connection is not a reconnection.
  let connectedBefore = false;

  // Unless it only came after a gap. An app opened during a deploy is
  // refused and retried with a backoff of up to a minute, while the lists it
  // fetched stay fresh for five: what the API emitted meanwhile is as lost as
  // on a reconnection. The expired token of a cold start is not such a gap,
  // since one refresh and an immediate retry fix it.
  let failedBefore = false;

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
        .then((fresh) => cb({ token: fresh ?? pushedToken ?? token }))
        .catch(() => cb({ token: pushedToken ?? token }));
    },
    autoConnect: false,
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,

    // A ten-second ceiling brought the whole foreground fleet back within ten
    // seconds of an outage, each handshake costing the API three queries. The
    // first retries stay quick; a long outage spreads out, each delay jittered
    // ±50%.
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
    timeout: 10_000,
  });

  socket.on("connect", () => {
    if (generation !== socketGeneration) return;
    cancelRefusalRetry();
    refusalAttempts = 0;
    connectionStatus.isConnected = true;
    connectionStatus.isConnecting = false;
    connectionStatus.hasConnectionError = false;
    connectionStatus.errorMessage = "";

    liveSince = Date.now();

    // Paused in the background, even before a first connection: the lists
    // skipped their focus refetch waiting for exactly this resync.
    const afterPause = pausedAt !== null;
    pausedAt = null;
    cancelReturnFallback();

    // Covers the manager's reconnections, the retry after a refusal and the
    // return from background after a pause (`pauseSocket` keeps the
    // instance). The last is NOT covered by the focus refetch, which skips
    // anything fetched in the past five minutes (`staleTime`) and, for these
    // lists, waits for this resync instead (MOB-20): one refetch of the
    // active realtime lists per return from a pause, none from a glance.
    if (connectedBefore || failedBefore || afterPause) scheduleResync();
    connectedBefore = true;
  });

  socket.on("disconnect", () => {
    if (generation !== socketGeneration) return;
    liveSince = null;
    connectionStatus.isConnected = false;
    connectionStatus.isConnecting = false;
  });

  socket.on("connect_error", (error) => {
    if (generation !== socketGeneration) return;
    connectionStatus.isConnected = false;
    connectionStatus.isConnecting = false;
    connectionStatus.hasConnectionError = true;
    connectionStatus.errorMessage = error.message;

    // A transport failure is still the manager's to retry (`active` stays
    // true). A refusal from the server ended this socket, and only we can
    // start it again.
    const refused = !socket.active;

    // Refusals are the server's verdict, worth seeing from outside; a dead
    // network is not news. Throttled per code by the telemetry itself.
    if (refused) {
      reportEvent("socket_refused", {
        code: socketErrorCode(error) ?? "UNKNOWN",
      });
    }

    const retry = () => {
      refusalRetry = null;
      if (generation !== socketGeneration) return;
      if (socket.connected || socket.active) return;

      connectionStatus.isConnecting = true;
      socket.connect();
    };

    const retryLater = (delayMs?: number) => {
      if (!refused) return;
      cancelRefusalRetry();
      refusalRetry = setTimeout(
        retry,
        delayMs ?? refusalRetryDelay(refusalAttempts++),
      );
    };

    // Reading the stored token at each attempt is not enough on its own: if
    // the stored one is the expired one, every retry carries it. One refresh,
    // through the single-flight refresher, is what actually breaks the loop.
    if (!shouldRefreshCredential(error) || !refreshAccessToken) {
      failedBefore = true;
      retryLater();
      return;
    }

    void refreshAccessToken()
      .then((token) => {
        // A null answer means the session is really gone. The auth store is
        // already being told by the same refresh, and it owns the logout.
        if (!token || generation !== socketGeneration) return;
        setSocketToken(token);

        // The credential was the problem and it is fixed: no reason to wait.
        retryLater(0);
      })
      .catch(() => {
        failedBefore = true;
        retryLater();
      });
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
    throw new Error("Token de autenticação não disponível");
  }

  if (!socketInstance) {
    socketInstance = createSocket(getSocketUrl(), token);
  } else {
    setSocketToken(token);
  }

  return socketInstance;
}

async function updateSocketAuthToken(token?: string): Promise<void> {
  const nextToken = token ?? (await tokenStorage.getAccessToken());
  if (!nextToken || !socketInstance) return;
  setSocketToken(nextToken);
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
  // Backgrounded: returning to the foreground reconnects on its own terms,
  // and that reconnection brings its own resync.
  cancelPendingPause();
  cancelRefusalRetry();
  cancelResync();
  cancelReturnFallback();
  if (!socketInstance) return;
  socketInstance.disconnect();
  pausedAt = pausedAt ?? Date.now();
  liveSince = null;
  connectionStatus.isConnected = false;
  connectionStatus.isConnecting = false;
}

/**
 * The app left the foreground: the socket is paused once the grace runs out,
 * not at once, so a glance at another app costs nothing on the way back.
 */
function backgroundSocket(now: number = Date.now()): void {
  // Already on its way out (inactive, then background): the absence began
  // at the first of them.
  if (pendingPause) return;

  leftForegroundAt = now;

  pendingPause = setTimeout(() => {
    pendingPause = null;
    pauseSocket();
  }, SOCKET_BACKGROUND_GRACE_MS);
}

/**
 * The app is back. The pending pause is dropped and the fallback armed
 * BEFORE anything is awaited: the focus refetch reads `socketResyncOwed` in
 * the same tick, and the pause must not fire behind a token read.
 */
async function foregroundSocket(): Promise<Socket> {
  cancelPendingPause();

  if (pausedAt !== null) armReturnFallback();

  // A token that could not be pushed is read by the handshake's own
  // callback anyway; the reconnection is not held back for it.
  await updateSocketAuthToken().catch(() => undefined);

  return reconnectSocket();
}

/** Whether the socket carried the last absence whole (see return-rules). */
function socketCarriedLastAbsence(now: number = Date.now()): boolean {
  return socketCarriedAbsence({ leftAt: leftForegroundAt, liveSince, now });
}

/** The socket was paused and a resync of the realtime lists is on its way. */
function socketResyncOwed(): boolean {
  return pausedAt !== null;
}

function disconnectSocket(notifyServer = true): void {
  const socket = socketInstance;
  if (!socket) return;

  // Detach the singleton immediately so a new login can never reuse a socket
  // authenticated with the previous session.
  socketInstance = null;
  socketGeneration += 1;
  pushedToken = null;
  cancelRefusalRetry();
  cancelResync();
  cancelPendingPause();
  cancelReturnFallback();
  pausedAt = null;
  liveSince = null;
  leftForegroundAt = null;
  refusalAttempts = 0;
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
  backgroundSocket,
  disconnectSocket,
  foregroundSocket,
  getConnectionStatus,
  getSocket,
  initializeSocket,
  isSocketConnected,
  onRealtimeResync,
  pauseSocket,
  reconnectSocket,
  RESYNC_JITTER_MS,
  setSocketTokenRefresher,
  socketCarriedLastAbsence,
  socketResyncOwed,
  updateSocketAuthToken,
};
