import { describe, expect, it } from "vitest";

import {
  AUTH_REFUSAL_CODES,
  shouldRefreshCredential,
  socketErrorCode,
} from "../../utils/socket-auth-rules";

/**
 * The socket reconnects forever by design — a driver in a tunnel must not lose
 * the channel because the app gave up. That same persistence is what made an
 * expired token catastrophic: the client retried it every few seconds, the
 * server refused every time, and nothing on screen said so.
 *
 * These tests pin the one decision that tells the two apart.
 */
const refusal = (code: string) =>
  Object.assign(new Error("Falha na autenticacao"), { data: { code } });

describe("a handshake refused because of the credential", () => {
  it("asks for a fresh token when the token is invalid or expired", () => {
    expect(shouldRefreshCredential(refusal("AUTH_TOKEN_INVALID"))).toBe(true);
  });

  it("asks for a fresh token when the session was invalidated", () => {
    expect(shouldRefreshCredential(refusal("AUTH_SESSION_INVALIDATED"))).toBe(
      true,
    );
  });

  it("names exactly the codes the API sends", () => {
    // This list is the coupling to the API's refusal vocabulary. A rename on
    // that side would otherwise turn recovery off with every test still green,
    // so the contract is written down rather than inferred.
    expect(AUTH_REFUSAL_CODES).toEqual([
      "AUTH_TOKEN_INVALID",
      "AUTH_SESSION_INVALIDATED",
    ]);
  });
});

describe("a handshake refused by the network", () => {
  it("does not touch the refresh endpoint for a plain transport error", () => {
    // No route to host, TLS failure, timeout: Socket.IO hands over a bare
    // Error. Refreshing here would hammer the API through every outage.
    expect(shouldRefreshCredential(new Error("xhr poll error"))).toBe(false);
  });

  it("ignores a refusal that carries no code", () => {
    expect(
      shouldRefreshCredential(Object.assign(new Error("nope"), { data: {} })),
    ).toBe(false);
  });

  it("ignores a refusal whose code is not about auth", () => {
    expect(shouldRefreshCredential(refusal("MODULE_NOT_ENABLED"))).toBe(false);
  });
});

describe("reading the code out of a socket error", () => {
  it("finds it under data", () => {
    expect(socketErrorCode(refusal("AUTH_TOKEN_INVALID"))).toBe(
      "AUTH_TOKEN_INVALID",
    );
  });

  it("survives everything Socket.IO might hand over instead", () => {
    // Called from an event handler, so anything that throws here takes the
    // handler with it and the socket stops reporting state at all.
    expect(socketErrorCode(undefined)).toBeUndefined();
    expect(socketErrorCode(null)).toBeUndefined();
    expect(socketErrorCode("boom")).toBeUndefined();
    expect(socketErrorCode({ data: "boom" })).toBeUndefined();
    expect(socketErrorCode({ data: { code: 42 } })).toBeUndefined();
  });
});
