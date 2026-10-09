import { JWTPayload } from "../types";

export const parseJwt = (token: string): JWTPayload | null => {
  try {
    // JWTs are base64url: `-` and `_` instead of `+` and `/`, which `atob`
    // refuses — and a payload that failed to parse read as expired forever.
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");

    return JSON.parse(atob(payload));
  } catch (error) {
    return null;
  }
};

/**
 * How far the server's clock is ahead of this phone's, in seconds.
 *
 * `exp` is on the server's clock and the check below runs on the phone's. A
 * clock set by hand twenty minutes ahead made every fresh token look expired,
 * so the app refreshed before EVERY request until the refresh limiter said no.
 */
let clockSkewSeconds = 0;

// Refresh slightly before the deadline, so a token does not expire in flight.
const EARLY_REFRESH_SECONDS = 10;

/**
 * Learns the skew from a token the server has just issued.
 *
 * `iat` is the server's `now` at issuance, a moment ago; only call this with
 * a token that just arrived (login, refresh), never one read back from disk.
 */
export const rememberClockSkewFrom = (
  token: string,
  deviceNowMs: number = Date.now(),
): void => {
  const issuedAt = parseJwt(token)?.iat;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return;

  clockSkewSeconds = issuedAt - deviceNowMs / 1000;
};

/** Forgets the learned skew. For tests. */
export const resetClockSkew = (): void => {
  clockSkewSeconds = 0;
};

export const isTokenExpired = (
  token: string,
  deviceNowMs: number = Date.now(),
): boolean => {
  const payload = parseJwt(token);
  if (!payload) return true;

  const serverNow = deviceNowMs / 1000 + clockSkewSeconds;
  return payload.exp <= serverNow + EARLY_REFRESH_SECONDS;
};

export const getTokenExpirationTime = (token: string): number | null => {
  const payload = parseJwt(token);
  return payload?.exp || null;
};
