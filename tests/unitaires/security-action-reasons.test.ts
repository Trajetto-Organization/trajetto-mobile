import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCESS_NOTICES,
  REASON_BY_REFUSAL_CODE,
} from "../../features/access/access-messages";
import { securityActionEndsSession } from "../../utils/socket-auth-rules";

/**
 * Which `securityAction` reasons log the driver out.
 *
 * The app logged out on every reason except `permissions_changed`, including
 * `access_restored` — an administrator GIVING access back threw the driver
 * out of the app. The API treats both as authorization-only
 * (trajetto-api session-policy.ts): the session survives, the app re-reads
 * /user/me. Anything the app does not know keeps ending the session.
 */
describe("a security action", () => {
  it.each(["access_restored", "permissions_changed"])(
    "%s keeps the session",
    (reason) => {
      expect(securityActionEndsSession(reason)).toBe(false);
    },
  );

  it.each(["access_revoked", "logout", "password_changed", "algo-novo"])(
    "%s ends it",
    (reason) => {
      expect(securityActionEndsSession(reason)).toBe(true);
    },
  );
});

/**
 * What the "Acesso encerrado" toast says for each reason the API really
 * sends.
 *
 * The table was keyed by a handful of reasons, and a password change, a
 * password reset, a role change, an edited account or a compromised session
 * all fell to the generic "Sua sessão foi encerrada" — the driver was thrown
 * out with no idea why, and a changed password was the one case where
 * knowing tells them what to type next. The emitters are read from the API
 * source, so a reason added there fails here until it has its words.
 * Skipped without ../trajetto-api (CI checks it out when the token exists).
 */
const API_SRC = resolve(process.cwd(), "..", "trajetto-api", "src");
const hasApi = existsSync(API_SRC);

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) return listTs(path);

    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** Every reason literal the API can put in a `securityAction`. */
function reasonsTheApiSends(): Set<string> {
  const reasons = new Set<string>();

  for (const file of listTs(API_SRC)) {
    const source = readFileSync(file, "utf8");

    // sendSecurityEventTo{User,Session,Business}(id, { reason: "x" }), also
    // the multi-line and ternary forms.
    for (const call of source.matchAll(
      /sendSecurityEventTo\w+\([\s\S]*?\}\s*\)/g,
    )) {
      const reasonPart = call[0].slice(call[0].indexOf("reason"));

      for (const literal of reasonPart.matchAll(/"([a-z_]+)"/g)) {
        reasons.add(literal[1]);
      }
    }
  }

  // The socket sweep's refusals (socket-revalidation.ts).
  const sweep = readFileSync(
    join(API_SRC, "shared", "socket", "socket-revalidation.ts"),
    "utf8",
  );

  for (const literal of sweep.matchAll(/end\("([a-z_]+)"\)/g)) {
    reasons.add(literal[1]);
  }

  const table = sweep.slice(sweep.indexOf("REASON_BY_ELIGIBILITY_CODE"));
  const tableBody = table.slice(table.indexOf("{"), table.indexOf("};"));

  for (const literal of tableBody.matchAll(/:\s*"([a-z_]+)"/g)) {
    reasons.add(literal[1]);
  }

  return reasons;
}

describe.skipIf(!hasApi)("the words for each reason the API sends", () => {
  const reasons = hasApi ? reasonsTheApiSends() : new Set<string>();

  it("finds the emitters (the scan itself)", () => {
    for (const known of [
      "access_revoked",
      "access_denied",
      "driver_inactive",
      "permissions_changed",
      "password_changed",
      "user_updated",
      "session_expired",
      "no_permissions",
      "logout",
    ]) {
      expect(reasons, known).toContain(known);
    }
  });

  it("has its own message for every reason that ends the session", () => {
    const ending = [...reasons].filter(securityActionEndsSession);

    // The session's own sign-out needs no explanation.
    const unexplained = ending.filter(
      (reason) =>
        reason !== "logout" &&
        !Object.prototype.hasOwnProperty.call(ACCESS_NOTICES, reason),
    );

    expect(unexplained).toEqual([]);
  });
});

/**
 * The session re-check's HTTP fallback names the same refusals as the
 * socket sweep: every eligibility code the API's sweep knows has a reason in
 * the app's REASON_BY_REFUSAL_CODE (decision 4.1).
 */
describe.skipIf(!hasApi)("the refusal codes of a /user/me 403", () => {
  it("cover every eligibility code the API's socket sweep maps", () => {
    const sweep = readFileSync(
      join(API_SRC, "shared", "socket", "socket-revalidation.ts"),
      "utf8",
    );
    const table = sweep.slice(sweep.indexOf("REASON_BY_ELIGIBILITY_CODE"));
    const tableBody = table.slice(table.indexOf("{"), table.indexOf("};"));

    const codes = [...tableBody.matchAll(/([A-Z_]+):\s*"/g)].map((match) => match[1]);

    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => !(code in REASON_BY_REFUSAL_CODE))).toEqual([]);
  });
});
