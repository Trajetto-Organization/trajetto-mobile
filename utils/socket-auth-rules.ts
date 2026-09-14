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

export { AUTH_REFUSAL_CODES, shouldRefreshCredential, socketErrorCode };
