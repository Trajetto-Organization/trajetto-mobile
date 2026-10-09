import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetTwoFactorChallenge,
  rememberTwoFactorChallenge,
  twoFactorChallengeFor,
} from "@/features/auth/two-factor-challenge";

/**
 * The app's half of binding two-factor to the password step (WEB-07).
 *
 * A password login that stops at two-factor now returns a
 * `twoFactorChallenge`, and the API accepts the code — and a resend — only
 * next to it (once TWO_FACTOR_CHALLENGE_REQUIRED is on). Without that tie,
 * anyone with an e-mail could have codes issued and guess them.
 *
 * The challenge is kept in memory only: it is a proof of the password for 30
 * minutes, and an app restarted on the code screen simply asks for the
 * password again. Against an API that sends none, the bodies stay exactly
 * what they were.
 */
beforeEach(() => {
  forgetTwoFactorChallenge();
});

describe("the challenge kept between the two steps", () => {
  it("goes back with the code and with a resend, for the same e-mail", () => {
    rememberTwoFactorChallenge("Gestora@Exemplo.com.br", "desafio-1");

    expect(twoFactorChallengeFor("gestora@exemplo.com.br")).toEqual({
      challenge: "desafio-1",
    });
  });

  it("never goes to another e-mail", () => {
    rememberTwoFactorChallenge("gestora@exemplo.com.br", "desafio-1");

    expect(twoFactorChallengeFor("outra@exemplo.com.br")).toEqual({});
  });

  it("is nothing at all when the API sent none, so the body is the old one", () => {
    rememberTwoFactorChallenge("gestora@exemplo.com.br", "desafio-1");
    rememberTwoFactorChallenge("gestora@exemplo.com.br", undefined);

    expect(twoFactorChallengeFor("gestora@exemplo.com.br")).toEqual({});
  });

  it("is gone once forgotten", () => {
    rememberTwoFactorChallenge("gestora@exemplo.com.br", "desafio-1");
    forgetTwoFactorChallenge();

    expect(twoFactorChallengeFor("gestora@exemplo.com.br")).toEqual({});
  });
});

describe("the auth store", () => {
  const store = readFileSync(
    resolve(__dirname, "../../store/auth-store.ts"),
    "utf8",
  );

  /** The source of one action of the store, from its key to the next one. */
  function action(name: string, next: string): string {
    const start = store.indexOf(`${name}: async`);
    const end = store.indexOf(`${next}: async`, start + 1);

    expect(start, `${name} not found`).toBeGreaterThan(-1);
    return store.slice(start, end === -1 ? undefined : end);
  }

  it("keeps the challenge the password step returned", () => {
    expect(action("login", "verifyTwoFactor")).toMatch(
      /rememberTwoFactorChallenge\(\s*email,\s*response\.twoFactorChallenge/,
    );
  });

  it("sends it with the code", () => {
    expect(action("verifyTwoFactor", "resendTwoFactorCode")).toMatch(
      /\{\s*email,\s*code,\s*\.\.\.twoFactorChallengeFor\(email\)\s*\}/,
    );
  });

  it("sends it with a resend", () => {
    expect(action("resendTwoFactorCode", "logout")).toMatch(
      /\{\s*email,\s*\.\.\.twoFactorChallengeFor\(email\)\s*\}/,
    );
  });

  it("forgets it when the session is established or the user leaves", () => {
    expect(action("verifyTwoFactor", "resendTwoFactorCode")).toContain(
      "forgetTwoFactorChallenge()",
    );
    expect(action("logout", "refreshToken")).toContain(
      "forgetTwoFactorChallenge()",
    );
  });
});
