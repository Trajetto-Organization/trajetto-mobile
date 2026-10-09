import { describe, expect, it } from "vitest";

import { signOutRemotely } from "@/features/auth/remote-logout";

/**
 * What the app tells the server when the driver logs out (MOB-05).
 *
 * The push unregister and the server logout left side by side. The
 * unregister needs a live session, so whenever the logout's revoke landed
 * first it was refused — silently — and the phone kept receiving the
 * driver's pushes, chat text included, after they had left. It also used the
 * stored access token as it was: fifteen minutes after the last request that
 * token had expired, and neither call got through at all.
 *
 * The server now drops a session's devices itself when the session ends;
 * these rules keep the app from depending on that alone.
 */
type Call = { what: string; token: string; startedAfter: string[] };

function recorder(
  options: {
    fail?: string[];
    renewed?: string | null;
  } = {},
) {
  const calls: Call[] = [];
  const settled: string[] = [];

  const settle = async <T>(what: string, value: T): Promise<T> => {
    // Settles on a later tick, like a request: whatever starts before this
    // resolves has overlapped with it.
    await new Promise((resolve) => setTimeout(resolve, 1));
    settled.push(what);

    if (options.fail?.includes(what)) throw new Error(`${what} failed`);

    return value;
  };

  return {
    calls,
    deps: {
      send: (method: string, path: string, token: string) => {
        const what = `${method} ${path}`;
        calls.push({ what, token, startedAfter: [...settled] });

        return settle(what, undefined);
      },
      renew: (refreshToken: string) => {
        calls.push({
          what: "renew",
          token: refreshToken,
          startedAfter: [...settled],
        });

        return settle(
          "renew",
          options.renewed === undefined ? "fresh-access" : options.renewed,
        );
      },
      isExpired: (token: string) => token.startsWith("expired"),
    },
  };
}

describe("a logout with a registered device", () => {
  it("unregisters the device first, and only then ends the session", async () => {
    const { calls, deps } = recorder();

    await signOutRemotely(
      { accessToken: "live", refreshToken: "refresh", pushToken: "push" },
      deps,
    );

    expect(calls.map((call) => call.what)).toEqual([
      "DELETE /notification/push-token",
      "POST /user/logout",
    ]);

    // Sequential, not parallel: the logout starts after the unregister is done.
    expect(calls[1].startedAfter).toContain("DELETE /notification/push-token");
  });

  it("still ends the session when the unregister fails", async () => {
    const { calls, deps } = recorder({
      fail: ["DELETE /notification/push-token"],
    });

    await signOutRemotely(
      { accessToken: "live", refreshToken: "refresh", pushToken: "push" },
      deps,
    );

    expect(calls.map((call) => call.what)).toContain("POST /user/logout");
  });
});

describe("a logout without a registered device", () => {
  it("only ends the session", async () => {
    const { calls, deps } = recorder();

    await signOutRemotely(
      { accessToken: "live", refreshToken: "refresh", pushToken: null },
      deps,
    );

    expect(calls.map((call) => call.what)).toEqual(["POST /user/logout"]);
  });
});

describe("a logout whose access token has expired", () => {
  it("renews it first, and uses the fresh one for both calls", async () => {
    const { calls, deps } = recorder();

    await signOutRemotely(
      { accessToken: "expired-access", refreshToken: "refresh", pushToken: "push" },
      deps,
    );

    expect(calls.map((call) => call.what)).toEqual([
      "renew",
      "DELETE /notification/push-token",
      "POST /user/logout",
    ]);

    expect(calls[0].token).toBe("refresh");
    expect(calls[1].token).toBe("fresh-access");
    expect(calls[2].token).toBe("fresh-access");
  });

  it("sends nothing when the session cannot be renewed", async () => {
    const { calls, deps } = recorder({ renewed: null });

    await signOutRemotely(
      { accessToken: "expired-access", refreshToken: "refresh", pushToken: "push" },
      deps,
    );

    // A forced logout: the server already ended the session, and dropped its
    // devices with it. Nothing left to tell it.
    expect(calls.map((call) => call.what)).toEqual(["renew"]);
  });

  it("does not throw when the renewal fails outright", async () => {
    const { deps } = recorder({ fail: ["renew"] });

    await expect(
      signOutRemotely(
        {
          accessToken: "expired-access",
          refreshToken: "refresh",
          pushToken: "push",
        },
        deps,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("a logout with nothing stored", () => {
  it("sends nothing", async () => {
    const { calls, deps } = recorder();

    await signOutRemotely(
      { accessToken: null, refreshToken: null, pushToken: "push" },
      deps,
    );

    expect(calls).toEqual([]);
  });
});

describe("a logout the server had already ended (401 AUTH_SESSION_INVALIDATED)", () => {
  const refused = Object.assign(new Error("Sessão expirada ou encerrada."), {
    status: 401,
    code: "AUTH_SESSION_INVALIDATED",
  });

  it("is done, not a failure: the session is over either way", async () => {
    const calls: string[] = [];

    await expect(
      signOutRemotely(
        { accessToken: "live", refreshToken: "refresh", pushToken: null },
        {
          send: async (method, path) => {
            calls.push(`${method} ${path}`);
            throw refused;
          },
          renew: async () => "fresh-access",
          isExpired: () => false,
        },
      ),
    ).resolves.toBeUndefined();

    expect(calls).toEqual(["POST /user/logout"]);
  });

  it("still reports any other failure (the server never answered)", async () => {
    const offline = Object.assign(new Error("Network request failed"), { status: 0 });

    await expect(
      signOutRemotely(
        { accessToken: "live", refreshToken: "refresh", pushToken: null },
        {
          send: async () => {
            throw offline;
          },
          renew: async () => "fresh-access",
          isExpired: () => false,
        },
      ),
    ).rejects.toBe(offline);
  });
});
