import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the API client puts in `ApiError.message` is read by a person
 * (MOB-18).
 *
 * The chat's "Mensagem não enviada" toast, the forgot-password toast, the
 * fuel-type picker, the vehicle, branch and driver lists and the pending
 * screen all show the message as it is. A request that never reached the
 * API carried the native text ("Network request failed"), a lapsed session
 * "Session expired", and a proxy's error page "HTTP 502: Bad Gateway". The
 * accent scan cannot see English, so a driver without signal read English.
 *
 * The real `apiClient` over a stubbed `fetch` and in-memory secure storage.
 */
const SERVER_NOW = Math.floor(Date.now() / 1000);

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const token = (iat: number) =>
  `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "user-1", iat, exp: iat + 900 })}.signature`;

const secure = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secure.set(key, value),
  deleteItemAsync: async (key: string) => void secure.delete(key),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    multiRemove: async () => undefined,
    getAllKeys: async () => [],
  },
}));

vi.mock("@/utils/socket", () => ({
  setSocketTokenRefresher: () => undefined,
  updateSocketAuthToken: async () => undefined,
}));

let apiClient: typeof import("@/utils/api").apiClient;
let ApiError: typeof import("@/utils/api").ApiError;

const SESSION_EXPIRED = "Sua sessão expirou. Faça login novamente.";
const NETWORK = "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.";

/** English that must never reach the screen through `ApiError.message`. */
const ENGLISH = /\b(network|request|failed|session|expired|error|unauthorized|bad gateway|timeout)\b/i;

beforeAll(async () => {
  vi.stubGlobal("__DEV__", false);
  process.env.EXPO_PUBLIC_API_URL = "https://api.trajetto.test";

  ({ apiClient, ApiError } = await import("@/utils/api"));
});

beforeEach(() => {
  secure.clear();
});

async function failureOf(call: Promise<unknown>) {
  const error = await call.then(
    () => null,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(ApiError);

  return error as InstanceType<typeof ApiError>;
}

describe("a request that never reached the API", () => {
  it("says so in Portuguese, not with the native 'Network request failed'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network request failed");
      }),
    );

    const error = await failureOf(apiClient.post("/chat/messages", { text: "oi" }, false));

    expect(error.category).toBe("NETWORK");
    expect(error.message).toBe(NETWORK);
    expect(error.message).not.toMatch(ENGLISH);

    // Still a network failure to the queue: retried, never thrown away.
    expect(error.isTransient).toBe(true);
  });

  it("says the same when the native layer throws something that is not an Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "offline";
      }),
    );

    const error = await failureOf(apiClient.get("/fuel-type/list", false));

    expect(error.message).toBe(NETWORK);
  });
});

describe("a session that lapsed", () => {
  it("uses the access screens' wording when there is nothing to renew", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    const error = await failureOf(apiClient.get("/user/me"));

    expect(error.status).toBe(401);
    expect(error.message).toBe(SESSION_EXPIRED);
  });

  it("uses it too for a 401 that carries no message of the API's own", async () => {
    secure.set(
      "session_v1",
      JSON.stringify({ version: 1, accessToken: token(SERVER_NOW), refreshToken: "refresh-0" }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/user/refresh-token")
          ? new Response(JSON.stringify({ code: "AUTH_REFRESH_INVALID" }), {
              status: 401,
              headers: { "content-type": "application/json" },
            })
          : new Response("<html>401</html>", {
              status: 401,
              statusText: "Unauthorized",
              headers: { "content-type": "text/html" },
            }),
      ),
    );

    const error = await failureOf(apiClient.get("/delivery/my-deliveries"));

    expect(error.status).toBe(401);
    expect(error.message).toBe(SESSION_EXPIRED);
  });

  it("keeps the API's own words when it gives them", async () => {
    secure.set(
      "session_v1",
      JSON.stringify({ version: 1, accessToken: token(SERVER_NOW), refreshToken: "refresh-0" }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/user/refresh-token")
          ? new Response(JSON.stringify({ code: "AUTH_REFRESH_INVALID" }), {
              status: 401,
              headers: { "content-type": "application/json" },
            })
          : new Response(JSON.stringify({ message: "Token expirado" }), {
              status: 401,
              headers: { "content-type": "application/json" },
            }),
      ),
    );

    const error = await failureOf(apiClient.get("/delivery/my-deliveries"));

    expect(error.message).toBe("Token expirado");
  });
});

describe("an error answer without the API's own message", () => {
  it("does not show the proxy's 'HTTP 502: Bad Gateway'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>502</html>", {
            status: 502,
            statusText: "Bad Gateway",
            headers: { "content-type": "text/html" },
          }),
      ),
    );

    const error = await failureOf(apiClient.get("/vehicle/list", false));

    expect(error.message).toBe("O servidor retornou um erro inesperado (HTTP 502).");
    expect(error.message).not.toMatch(ENGLISH);

    // What the proxy said is still there for whoever reads the error.
    expect(error.statusText).toBe("Bad Gateway");
    expect(error.nonJsonBody).toBe(true);
  });

  it("nor for JSON that has no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "SOMETHING" }), {
            status: 400,
            statusText: "Bad Request",
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const error = await failureOf(apiClient.get("/vehicle/list", false));

    expect(error.message).toBe("O servidor retornou um erro inesperado (HTTP 400).");
    expect(error.code).toBe("SOMETHING");
  });

  it("keeps the API's own message when there is one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "Quilometragem inferior à atual" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const error = await failureOf(apiClient.get("/vehicle/list", false));

    expect(error.message).toBe("Quilometragem inferior à atual");
  });
});

/**
 * The same mistake in the source, before it reaches a phone: an English
 * sentence given as the message of an error the app shows. Identifiers and
 * `AbortError` messages (never shown) are not message literals of these.
 */
describe("the messages the app writes into its own errors", () => {
  const ROOT = resolve(__dirname, "../..");
  const DIRS = ["app", "components", "features", "hooks", "providers", "store", "utils"];

  const listFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);

      if (statSync(path).isDirectory()) return listFiles(path);

      return /\.tsx?$/.test(name) ? [path] : [];
    });

  it("are Portuguese in every ApiError, UploadError and LocationCaptureError", () => {
    const shown = /new (ApiError|UploadError|LocationCaptureError)\(\s*(?:[a-z]+,\s*)?(["'`])((?:(?!\2).)*)\2/g;

    const english = DIRS.flatMap((dir) => listFiles(join(ROOT, dir))).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const where = relative(ROOT, file).replace(/\\/g, "/");

      return [...source.matchAll(shown)]
        .filter((match) => ENGLISH.test(match[3]))
        .map((match) => `${where}: ${match[3]}`);
    });

    expect(english).toEqual([]);
  });
});
