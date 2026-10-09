import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, isTerminalAuthFailure } from "@/utils/api-error";
import {
  classifyFailure,
  nextAfterFailure,
} from "@/features/submissions/outbox-rules";
import {
  decideSubmissionFailure,
  queuedOutcome,
} from "@/features/submissions/queue-decision";
import { refusalVerdict } from "@/features/submissions/kind-refusals";
import { classifyBatchFailure } from "@/features/tracking/state-rules";

/**
 * The API's status/code changes of the HTTP-honesty wave (decision 11.3), as
 * the app reads them.
 *
 * The one that touched the driver's work: a session whose own user was
 * deleted now answers 404 USER_NOT_FOUND (it was a 400, sometimes without a
 * code) on list-my-deliveries, start-route, arrival, occurrences, fuel and
 * chat. The app read it as a refusal on the merits: the outbox FAILED the
 * driver's queued proof with "Recurso não encontrado!", the session stayed
 * up against an account that is gone, and the tracker resent the same batch
 * every two minutes. It is the session ending, said with another status.
 */

// A stored session with an access token that has not expired, so the client
// sends the request instead of refreshing first.
const storedSession = vi.hoisted(() => {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: "u-1",
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;

  return JSON.stringify({ version: 1, accessToken, refreshToken: "refresh" });
});

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => (key === "session_v1" ? storedSession : null),
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

vi.mock("@/utils/socket", () => ({
  setSocketTokenRefresher: () => undefined,
  updateSocketAuthToken: async () => undefined,
}));

const userGone = () =>
  new ApiError("Recurso não encontrado!", 404, "Not Found", "HTTP", "USER_NOT_FOUND");

const describeError = (error: ApiError) => ({
  source: "api" as const,
  isAuthenticationError: error.isAuthenticationError,
  isTransient: error.isTransient,
  code: error.code,
});

describe("404 USER_NOT_FOUND ends the session", () => {
  it("is a terminal auth failure, like AUTH_SESSION_INVALID", () => {
    expect(isTerminalAuthFailure(404, "USER_NOT_FOUND")).toBe(true);
    expect(userGone().isAuthenticationError).toBe(true);
    expect(userGone().isTransient).toBe(false);
  });

  it("leaves a queued item untouched for the next sign-in instead of failing it", () => {
    const failure = classifyFailure(describeError(userGone()));

    expect(failure).toBe("auth");
    // Null = the item keeps its attempts and status; nothing is dropped.
    expect(nextAfterFailure({ attempts: 2 }, failure, 1_000)).toBeNull();
  });

  it("queues a fresh submission as signed-out rather than handing it back as refused", () => {
    const failure = {
      isAbort: false,
      description: describeError(userGone()),
    };

    expect(decideSubmissionFailure(failure)).toBe("queued");
    expect(queuedOutcome(failure)).toBe("queued-signed-out");
  });

  it("is never read by a kind's refusal rules as 'already done'", () => {
    expect(
      refusalVerdict(
        {
          id: "p-1",
          kind: "delivery-pause-end",
          status: "pending",
          businessId: "b-1",
          endpoint: "/driver-pause/end",
          body: {},
          createdAt: new Date(0).toISOString(),
        },
        describeError(userGone()),
        [],
      ),
    ).toBeNull();
  });

  it("stops the tracker as signed-out, keeping the trail, instead of resending forever", () => {
    expect(classifyBatchFailure(userGone())).toBe("signed-out");
  });

  it("does not turn other 404s into a logout", () => {
    const deliveryGone = new ApiError(
      "Entrega não encontrada!",
      404,
      "Not Found",
      "HTTP",
      "DELIVERY_NOT_FOUND",
    );

    expect(deliveryGone.isAuthenticationError).toBe(false);
    expect(classifyFailure(describeError(deliveryGone))).toBe("permanent");
    expect(classifyBatchFailure(deliveryGone)).toBe("retry");
    // The proxy's 404 (no API behind it) still waits for the API.
    expect(
      classifyBatchFailure({ status: 404, nonJsonBody: true, code: undefined }),
    ).toBe("retry");
  });
});

describe("the other answers that changed shape", () => {
  it("a 500 is INTERNAL_ERROR now (was BAD_REQUEST) and is still retried", () => {
    const error = new ApiError(
      "Houve um erro ao tentar enviar o código",
      500,
      "Internal Server Error",
      "HTTP",
      "INTERNAL_ERROR",
    );

    expect(classifyFailure(describeError(error))).toBe("transient");
    expect(nextAfterFailure({ attempts: 0 }, "transient", 0)?.status).toBe("pending");
  });

  it("a route the driver lost (404 DELIVERY_ROUTE_NOT_FOUND) fails visibly, never in a loop", () => {
    const error = new ApiError(
      "Rota não encontrada.",
      404,
      "Not Found",
      "HTTP",
      "DELIVERY_ROUTE_NOT_FOUND",
    );

    const failure = classifyFailure(describeError(error));

    expect(failure).toBe("permanent");
    expect(nextAfterFailure({ attempts: 0 }, failure, 0)?.status).toBe("failed");
  });
});

describe("the HTTP client on 404 USER_NOT_FOUND", () => {
  let apiClient: typeof import("@/utils/api").apiClient;
  let logout: ReturnType<typeof vi.fn<[], Promise<void>>>;

  beforeAll(async () => {
    vi.stubGlobal("__DEV__", false);
    process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

    ({ apiClient } = await import("@/utils/api"));
  });

  beforeEach(() => {
    logout = vi.fn<[], Promise<void>>(async () => undefined);
    apiClient.setLogoutCallback(logout);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: "USER_NOT_FOUND", message: "Recurso não encontrado!" }),
            { status: 404, headers: { "content-type": "application/json" } },
          ),
      ),
    );
  });

  it("signs the driver out on an authenticated route", async () => {
    await expect(apiClient.get("/delivery/list-my-deliveries/b-1")).rejects.toMatchObject({
      status: 404,
      code: "USER_NOT_FOUND",
    });

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("does not sign anybody out on an anonymous route", async () => {
    await expect(
      apiClient.post("/user/two-factor-verification", { email: "a@b.c", code: "1" }, false),
    ).rejects.toMatchObject({ status: 404 });

    expect(logout).not.toHaveBeenCalled();
  });
});
