/**
 * What the API answered, and what that answer means for retrying.
 *
 * Split out of `api.ts` rather than left beside the fetch wrapper, for the
 * reason `vitest.config.ts` states: a module that needs a native mock to be
 * tested is a module with decisions in the wrong place. `isTransient` decides
 * whether a driver's queued proof of delivery is retried or thrown away, and
 * reaching it through `api.ts` means loading the socket client, the token
 * storage and the connection store — so until now nothing tested it directly.
 *
 * Nothing here imports anything.
 */

export type ApiErrorCategory = "HTTP" | "NETWORK" | "TIMEOUT" | "CONFIGURATION";

/**
 * What a person reads when the request never reached the API.
 *
 * The native text ("Network request failed") is English and names no way
 * out, and the chat, the forgot-password toast, the pickers and the pending
 * screen all show `ApiError.message` as it is (MOB-18). The native text
 * stays in the dev log only.
 */
export const NETWORK_ERROR_MESSAGE =
  "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.";

/**
 * An error answer with no message of the API's own: a non-JSON body (the
 * proxy in front of it) or JSON without one. `statusText` is English, and
 * often empty on Android, which left "HTTP 502: " on screen.
 */
export function unexpectedResponseMessage(status: number): string {
  return `O servidor retornou um erro inesperado (HTTP ${status}).`;
}

/**
 * Failures a new token cannot fix.
 *
 * A 401 normally means "refresh and try again", and the client does exactly
 * that. These say the account itself is no longer allowed in — revoked
 * access, an inactive company, a driver who belongs to another tenant — so
 * refreshing would loop forever against an answer that will not change.
 */
const TERMINAL_AUTH_ERROR_CODES = new Set([
  "AUTH_ACCESS_REVOKED",
  "AUTH_BRANCH_INACTIVE",
  "AUTH_BUSINESS_INACTIVE",
  "AUTH_BUSINESS_REQUIRED",
  "AUTH_DRIVER_INACTIVE",
  "AUTH_DRIVER_TENANT_MISMATCH",
  "AUTH_PROFILE_NOT_CONFIGURED",
  "AUTH_REFRESH_INVALID",
  "AUTH_REFRESH_REUSED",
  "AUTH_SESSION_INVALID",
  "AUTH_SESSION_INVALIDATED",
  "AUTH_TOKEN_INVALID",
  "AUTH_TOKEN_MISSING",

  // 404: the session's own user was deleted while the session was still
  // open. Every authenticated route this app calls answers it only about the
  // caller, so it is the same verdict as AUTH_SESSION_INVALID. Read as an
  // ordinary refusal, the outbox failed the driver's queued work with
  // "Recurso não encontrado!" instead of keeping it for the next sign-in.
  "USER_NOT_FOUND",
]);

/**
 * Whether this answer means the session is over, rather than stale.
 *
 * A function rather than only a getter because the refresh path asks the same
 * question before an `ApiError` exists — it has a raw status and a code, and
 * it used to re-implement this check inline against the same set. Two copies
 * of a rule about when to log somebody out is one copy too many.
 */
export function isTerminalAuthFailure(
  status: number,
  code: string | undefined,
): boolean {
  return (
    status === 401 || (code !== undefined && TERMINAL_AUTH_ERROR_CODES.has(code))
  );
}

/**
 * A `Retry-After` header in milliseconds: delta-seconds or an HTTP-date.
 *
 * Undefined when absent or unreadable, never negative. The outbox waits at
 * least this long before trying the same item again.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  // Anything else has to be an HTTP-date; `Date.parse` alone takes "-5" too.
  if (!/[a-z]/i.test(trimmed)) return undefined;

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;

  return Math.max(0, date - now);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
    public category: ApiErrorCategory = "HTTP",
    public code?: string,

    /** From `Retry-After`, when the API said how long to wait. */
    public retryAfterMs?: number,

    /**
     * The error body was not JSON. Every answer the API itself gives is, so
     * this is something in front of it speaking — see `isTransient`.
     */
    public nonJsonBody = false,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isAuthenticationError(): boolean {
    return isTerminalAuthFailure(this.status, this.code);
  }

  /**
   * Worth trying again.
   *
   * Everything here is the request not having been decided on its merits: the
   * radio was off, the socket timed out, a limiter said slow down, or the
   * server broke before it could answer. The queue repeats these; it gives up
   * on everything else.
   *
   * `status >= 500` is load-bearing beyond the obvious. The API answers 503
   * `STORAGE_UNAVAILABLE` when the object store is unreachable, and it does so
   * precisely because of this line — that response used to be a 400, which
   * this classified as final, which made the outbox discard the photo.
   *
   * A 404 that is not JSON is the proxy in front of the API, answering while
   * no API replica is up — not the API saying the route is gone (its own
   * 404 is JSON, with a code). Final, it failed every item the queue tried
   * during a bad deploy.
   */
  get isTransient(): boolean {
    return (
      this.category === "NETWORK" ||
      this.category === "TIMEOUT" ||
      this.status === 408 ||
      this.status === 429 ||
      this.status >= 500 ||
      (this.status === 404 && this.nonJsonBody)
    );
  }
}
