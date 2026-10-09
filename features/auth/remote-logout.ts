/**
 * What the app tells the server when someone logs out: forget this device's
 * push token, then end the session. Pure, so the order can be tested without
 * a phone (see tests/unitaires/remote-logout.test.ts).
 */

type RemoteMethod = "POST" | "DELETE";

interface RemoteLogoutSession {
  accessToken: string | null;
  refreshToken: string | null;

  /** The Expo push token this session registered, if any. */
  pushToken: string | null;
}

interface RemoteLogoutDeps {
  /** One call to the API, authenticated with the given access token. */
  send: (
    method: RemoteMethod,
    path: string,
    accessToken: string,
    body?: unknown,
  ) => Promise<unknown>;

  /** Trades the refresh token for a fresh access token; null if refused. */
  renew: (refreshToken: string) => Promise<string | null>;

  isExpired: (accessToken: string) => boolean;
}

/**
 * Best-effort, and never throws for the unregister or the renewal.
 *
 * In ORDER, not side by side. The unregister needs a live session, and the
 * logout is what ends it: sent together, the logout's revoke often landed
 * first, the unregister was refused, the error was swallowed and the phone
 * kept receiving the user's pushes — chat text included — after they left.
 *
 * An access token lives fifteen minutes, so at logout it has often expired
 * and both calls would be refused. It is renewed first; the renewal's new
 * refresh token is simply dropped, because the logout right after it ends
 * that whole session anyway. When the renewal is refused the session is
 * already over on the server (a forced logout), and the server dropped its
 * devices when it ended it.
 */
async function signOutRemotely(
  session: RemoteLogoutSession,
  deps: RemoteLogoutDeps,
): Promise<void> {
  let accessToken =
    session.accessToken && !deps.isExpired(session.accessToken)
      ? session.accessToken
      : null;

  if (!accessToken && session.refreshToken) {
    accessToken = await deps
      .renew(session.refreshToken)
      .catch(() => null);
  }

  if (!accessToken) return;

  if (session.pushToken) {
    await deps
      .send("DELETE", "/notification/push-token", accessToken, {
        token: session.pushToken,
      })
      .catch(() => undefined);
  }

  try {
    await deps.send("POST", "/user/logout", accessToken);
  } catch (error) {
    // 401 (AUTH_SESSION_INVALIDATED and kin): the server had already ended
    // this session — a forced logout, or another device revoked it. That is
    // what the call was for, so it is done, not a failure to report.
    if (sessionAlreadyEnded(error)) return;

    throw error;
  }
}

/** The API's answer that the session this token belongs to is over. */
function sessionAlreadyEnded(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 401
  );
}

export { sessionAlreadyEnded, signOutRemotely };
export type { RemoteLogoutDeps, RemoteLogoutSession };
