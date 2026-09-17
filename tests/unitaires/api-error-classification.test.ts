import { describe, expect, it } from "vitest";

import { ApiError, isTerminalAuthFailure } from "@/utils/api-error";
import {
  classifyFailure,
  nextAfterFailure,
} from "@/features/submissions/outbox-rules";

/**
 * How an HTTP answer becomes a decision about a driver's work.
 *
 * `outbox-failure-rules.test.ts` covers the second half of that chain — given
 * a described failure, what the queue does. It cannot cover the first half,
 * because the description comes from `ApiError`, which lived in `api.ts`
 * behind the socket client and the token storage. It does not any more, and
 * this file closes the gap: a status number in, a queue outcome out.
 *
 * The case that matters most is the one that was wrong. The API answers
 * 503 `STORAGE_UNAVAILABLE` when the object store is unreachable; it used to
 * answer 400 `UPLOADED_FILE_NOT_FOUND` for the same condition, and this chain
 * turned that into `permanent`, `status: "failed"`, and a proof of delivery
 * the driver could never re-take.
 */

/** What `describeFailure` in the outbox builds out of a thrown ApiError. */
const describe_ = (error: ApiError) => ({
  source: "api" as const,
  isAuthenticationError: error.isAuthenticationError,
  isTransient: error.isTransient,
  code: error.code,
});

const outcomeOf = (error: ApiError) => {
  const failure = classifyFailure(describe_(error));

  return {
    failure,
    next: nextAfterFailure({ attempts: 0 }, failure, 1_000),
  };
};

describe("storage outage keeps the driver's proof", () => {
  it("retries a 503 from the object store instead of discarding it", () => {
    const { failure, next } = outcomeOf(
      new ApiError(
        "O armazenamento de arquivos está indisponível no momento.",
        503,
        "Service Unavailable",
        "HTTP",
        "STORAGE_UNAVAILABLE",
      ),
    );

    expect(failure).toBe("transient");
    expect(next?.status).toBe("pending");
  });

  it("still gives up when the object really is gone", () => {
    // The other half of the same distinction. A presigned PUT that never
    // completed leaves nothing in the bucket, and asking again tomorrow
    // returns the same nothing — retrying that forever is its own bug.
    const { failure, next } = outcomeOf(
      new ApiError(
        "Arquivo enviado não foi encontrado no armazenamento.",
        400,
        "Bad Request",
        "HTTP",
        "UPLOADED_FILE_NOT_FOUND",
      ),
    );

    expect(failure).toBe("permanent");
    expect(next?.status).toBe("failed");
  });
});

describe("what ApiError calls worth repeating", () => {
  it.each([500, 502, 503, 504])("retries a %d", (status) => {
    expect(new ApiError("", status, "", "HTTP").isTransient).toBe(true);
  });

  it("retries a timeout the server never saw", () => {
    expect(new ApiError("", 0, "", "TIMEOUT").isTransient).toBe(true);
  });

  it("retries when the radio was the problem", () => {
    expect(new ApiError("", 0, "", "NETWORK").isTransient).toBe(true);
  });

  it("retries a 429, which is the server asking rather than refusing", () => {
    expect(new ApiError("", 429, "", "HTTP").isTransient).toBe(true);
  });

  it("retries a 408", () => {
    expect(new ApiError("", 408, "", "HTTP").isTransient).toBe(true);
  });

  it.each([400, 403, 404, 409, 422])("does not retry a %d", (status) => {
    // Decided on the merits. The same request produces the same answer, and
    // repeating it costs battery and data for nothing.
    expect(new ApiError("", status, "", "HTTP").isTransient).toBe(false);
  });

  it("does not retry a 499 — the boundary is 500, not 'four hundred something'", () => {
    expect(new ApiError("", 499, "", "HTTP").isTransient).toBe(false);
  });

  it("is misconfiguration, not weather", () => {
    // A missing EXPO_PUBLIC_API_URL does not get better by waiting.
    expect(new ApiError("", 0, "", "CONFIGURATION").isTransient).toBe(false);
  });
});

describe("which failures end the session", () => {
  it("treats a plain 401 as one", () => {
    expect(isTerminalAuthFailure(401, undefined)).toBe(true);
  });

  it("treats revoked access as one even with a 403", () => {
    // The status alone is not enough: the API answers 403 when a profile has
    // been taken away, and the app must stop rather than keep refreshing.
    expect(isTerminalAuthFailure(403, "AUTH_ACCESS_REVOKED")).toBe(true);
  });

  it("does not treat an ordinary 403 as one", () => {
    expect(isTerminalAuthFailure(403, "FORBIDDEN")).toBe(false);
  });

  it("leaves the session alone when the store is merely unreadable", () => {
    /**
     * `AUTH_SESSION_UNAVAILABLE` is deliberately NOT in the terminal list: it
     * is the API's 503 for "I could not check your session right now", and
     * logging somebody out over it would sign out a whole fleet the moment
     * Redis hiccuped. Asserted here so adding it to that list has to be a
     * decision rather than an accident.
     */
    expect(isTerminalAuthFailure(503, "AUTH_SESSION_UNAVAILABLE")).toBe(false);

    const { failure, next } = outcomeOf(
      new ApiError("", 503, "", "HTTP", "AUTH_SESSION_UNAVAILABLE"),
    );

    expect(failure).toBe("transient");
    expect(next?.status).toBe("pending");
  });
});
