/**
 * The Expo push token this session registered with the API. Kept in module
 * state so the logout flow can unregister the device best-effort — the
 * server also reassigns tokens on login and prunes dead ones, so losing
 * this value is never fatal.
 */
let currentPushToken: string | null = null;

function setRegisteredPushToken(token: string | null): void {
  currentPushToken = token;
}

function getRegisteredPushToken(): string | null {
  return currentPushToken;
}

export { setRegisteredPushToken, getRegisteredPushToken };
