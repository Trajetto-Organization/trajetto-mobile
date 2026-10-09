/**
 * What a failed socket handshake means, and therefore what to do about it.
 *
 * Pure and import-free so the one decision that matters can be tested: a
 * connection refused because the credential is dead has to be answered with a
 * new credential, and a connection refused because the network is dead has to
 * be answered with patience. Getting that backwards in either direction is
 * expensive — treat a network blip as an auth failure and the app hammers the
 * refresh endpoint; treat an expired token as a blip and the app retries a
 * dead credential forever, which is the bug this replaces.
 */

/**
 * The codes `websocket.ts` sends in `error.data.code` when the credential is
 * the problem. Naming them here is deliberate: it is the one place where this
 * app is coupled to the API's refusal vocabulary, and a rename on that side
 * would otherwise silently turn recovery off with every test still green.
 */
const AUTH_REFUSAL_CODES = ["AUTH_TOKEN_INVALID", "AUTH_SESSION_INVALIDATED"];

/**
 * Socket.IO wraps server-side handshake refusals and hangs the payload off
 * `error.data`. A transport-level failure — no route to host, TLS, timeout —
 * arrives as a plain Error with nothing there.
 */
function socketErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;

  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;

  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Whether this refusal is worth answering with a fresh token. */
function shouldRefreshCredential(error: unknown): boolean {
  const code = socketErrorCode(error);

  return code !== undefined && AUTH_REFUSAL_CODES.includes(code);
}

/**
 * How long to wait before trying again after the server refused a handshake.
 *
 * socket.io-client retries a transport failure by itself, but a refusal from
 * the server's middleware ends the socket for good (`active` goes false) —
 * and every refusal counts, not only the auth ones: a rate-limited handshake
 * during a deploy, or the database blinking mid-handshake. Nothing called
 * `connect()` again, so the driver's app sat without realtime until it went
 * to the background and back.
 *
 * Doubling from one second to a minute, with ±50% jitter: after a deploy the
 * whole fleet is refused at the same moment, and without jitter it would come
 * back at the same moment too.
 */
const REFUSAL_RETRY_BASE_MS = 1_000;
const REFUSAL_RETRY_MAX_MS = 60_000;

function refusalRetryDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(
    REFUSAL_RETRY_MAX_MS,
    REFUSAL_RETRY_BASE_MS * 2 ** Math.max(0, attempt),
  );

  return Math.round(ceiling * (0.5 + random()));
}

/**
 * `securityAction` reasons that change what the session may do, not whether
 * it exists. Mirrors trajetto-api `src/shared/security/session-policy.ts`:
 * the server keeps the socket for these, and the app re-reads /user/me
 * instead of logging out. `access_restored` used to log the driver out — the
 * one event that GIVES access back.
 */
const AUTHORIZATION_ONLY_REASONS = ["access_restored", "permissions_changed"];

/** Default-deny: a reason this build does not know still ends the session. */
function securityActionEndsSession(reason: string): boolean {
  return !AUTHORIZATION_ONLY_REASONS.includes(reason);
}

export {
  AUTH_REFUSAL_CODES,
  AUTHORIZATION_ONLY_REASONS,
  REFUSAL_RETRY_MAX_MS,
  refusalRetryDelay,
  securityActionEndsSession,
  shouldRefreshCredential,
  socketErrorCode,
};
