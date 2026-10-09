import {
  ApiError,
  NETWORK_ERROR_MESSAGE,
  isTerminalAuthFailure,
  parseRetryAfter,
  unexpectedResponseMessage,
} from "./api-error";
import { isReleaseBundle, releaseApiUrlProblem } from "./api-url-rules";
import { isTokenExpired } from "./jwt";
import { logger } from "./logger";
import { reportEvent } from "./telemetry";

import { setSocketTokenRefresher, updateSocketAuthToken } from "./socket";
import { tokenStorage } from "./storage";

import { reportApiReachable } from "@/store/connection-store";
import { reportUpgradeRequired } from "@/store/upgrade-store";
import { isUpgradeRequired } from "@/features/app-update/upgrade-rules";
import { accessNotice } from "@/features/access/access-messages";
import { clientVersionHeader } from "./client-version";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "");

/**
 * Why this bundle refuses its own API URL, when it does.
 *
 * `eas update` never runs the build's HTTPS check, so a bundle published from
 * a laptop could carry `http://192.168.x.x` to every phone. A release bundle
 * refuses such a URL before anything is sent — see `api-url-rules`.
 */
const API_URL_REFUSAL =
  API_BASE_URL && isReleaseBundle() ? releaseApiUrlProblem(API_BASE_URL) : null;

if (API_URL_REFUSAL) logger.error(`apiClient: ${API_URL_REFUSAL}`);

/**
 * Classified like an unreachable API, on purpose: a final error would log
 * every driver out (`checkAuth`) and fail every queued proof, over a bundle
 * the next update fixes. Nothing is sent either way.
 */
const refusedApiUrlError = (message: string): ApiError => {
  reportApiReachable(false);

  return new ApiError(message, 0, "Refused API URL", "NETWORK");
};

const DEFAULT_TIMEOUT_MS = 20_000;

/** The one wording for a session that lapsed, shared with the access screens. */
const SESSION_EXPIRED_MESSAGE = accessNotice("session_expired").message;

/**
 * Tells the API this is the app. A session opened with it gets the app's
 * refresh policy — a week without signal before it lapses, instead of the
 * web's day — which is what the offline queue needs to still hold a session
 * when the phone comes back. It only picks a policy for the caller's own new
 * session, within the API's absolute cap; it grants nothing else.
 */
const CLIENT_HEADERS = { "x-trajetto-client": "mobile" } as const;

/**
 * The above, plus which build this is once the boot code has described it
 * (`client-version.ts`): the one way the API can tell which builds still
 * call a contract, and turn away one below MIN_MOBILE_CONTRACT. A separate
 * header, because the one above is compared as an exact value.
 */
const clientHeaders = (): Record<string, string> => {
  const version = clientVersionHeader();

  return version
    ? { ...CLIENT_HEADERS, "x-trajetto-client-version": version }
    : { ...CLIENT_HEADERS };
};

/**
 * Re-exported so every existing `from "@/utils/api"` keeps working. The class
 * itself lives in `api-error.ts`, which imports nothing and can therefore be
 * tested without the socket client, the token storage or the connection store.
 */
export { ApiError } from "./api-error";
export type { ApiErrorCategory } from "./api-error";

interface ApiRequestConfig {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  requiresAuth?: boolean;
  signal?: AbortSignal;
  responseType?: "auto" | "text";
  timeoutMs?: number;
  authRetryAttempted?: boolean;
}

interface RequestContext {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
}

type LogoutCallback = () => void | Promise<void>;

const createAbortError = (message = "Request aborted"): Error => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

interface ApiErrorDetails {
  message: string;

  /** The API gave no message of its own; `message` is our generic one. */
  generic?: boolean;

  code?: string;

  /** The body was not JSON: not the API's own answer (see ApiError). */
  nonJson?: boolean;

  /** Where a 426 CLIENT_UPGRADE_REQUIRED sends the driver, when it says. */
  storeUrl?: string;
}

const getErrorDetails = async (
  response: Response,
): Promise<ApiErrorDetails> => {
  const fallback = unexpectedResponseMessage(response.status);
  try {
    const errorData = (await response.json()) as {
      message?: string;
      code?: string;
      error?: string | { message?: string; code?: string };
      storeUrl?: unknown;
    };
    const nestedError =
      typeof errorData.error === "object" ? errorData.error : undefined;
    const ownMessage =
      errorData.message ||
      nestedError?.message ||
      (typeof errorData.error === "string" ? errorData.error : undefined);

    return {
      message: ownMessage || fallback,
      generic: !ownMessage,
      code:
        errorData.code ||
        nestedError?.code ||
        response.headers.get("x-error-code") ||
        undefined,
      storeUrl:
        typeof errorData.storeUrl === "string" ? errorData.storeUrl : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return {
      message: fallback,
      generic: true,
      code: response.headers.get("x-error-code") || undefined,
      nonJson: true,
    };
  }
};

/**
 * How long the API asked us to back off. Only a 429 or a 503 means it; the
 * outbox waits at least this long before sending the same item again.
 */
const retryAfterOf = (response: Response): number | undefined =>
  response.status === 429 || response.status === 503
    ? parseRetryAfter(response.headers.get("retry-after"))
    : undefined;

class ApiClient {
  private refreshPromise: Promise<string | null> | null = null;
  private logoutCallback: LogoutCallback | null = null;

  private unauthorizedPromise: Promise<void> | null = null;
  private sessionEpoch = 0;

  private authenticatedControllers = new Set<AbortController>();

  setLogoutCallback(callback: LogoutCallback | null): void {
    this.logoutCallback = callback;
  }

  /** Cancels work belonging to the previous credentials. */
  invalidateSession(): number {
    this.sessionEpoch += 1;

    this.authenticatedControllers.forEach((controller) => controller.abort());
    this.authenticatedControllers.clear();

    this.refreshPromise = null;
    return this.sessionEpoch;
  }

  private async handleUnauthorized(): Promise<void> {
    if (!this.logoutCallback) return;
    if (this.unauthorizedPromise) return this.unauthorizedPromise;

    this.unauthorizedPromise = Promise.resolve(this.logoutCallback()).finally(
      () => {
        this.unauthorizedPromise = null;
      },
    );

    return this.unauthorizedPromise;
  }

  private createRequestContext(
    externalSignal: AbortSignal | undefined,
    requiresAuth: boolean,
    timeoutMs: number,
  ): RequestContext {
    const controller = new AbortController();
    let timedOut = false;

    const abortFromExternalSignal = () => controller.abort();
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", abortFromExternalSignal, {
        once: true,
      });
    }

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    if (requiresAuth) {
      this.authenticatedControllers.add(controller);
    }

    return {
      signal: controller.signal,
      didTimeout: () => timedOut,
      cleanup: () => {
        clearTimeout(timeout);

        externalSignal?.removeEventListener("abort", abortFromExternalSignal);
        this.authenticatedControllers.delete(controller);
      },
    };
  }

  private normalizeFetchError(error: unknown, context: RequestContext): never {
    if (error instanceof ApiError) throw error;
    if (context.didTimeout()) {
      reportApiReachable(false);
      throw new ApiError(
        "A requisição excedeu o tempo limite. Tente novamente.",
        0,
        "Request Timeout",
        "TIMEOUT",
      );
    }

    // Aborts are our own doing — a screen unmounting, a session changing — and
    // say nothing about whether the server is there.
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (context.signal.aborted) {
      throw createAbortError();
    }

    reportApiReachable(false);

    // The native text is English and screens show this message as is.
    logger.dev(
      "apiClient: network failure",
      error instanceof Error ? error.message : error,
    );

    throw new ApiError(NETWORK_ERROR_MESSAGE, 0, "Network Error", "NETWORK");
  }

  private async performRefreshToken(): Promise<string | null> {
    const requestEpoch = this.sessionEpoch;

    const storageEpoch = tokenStorage.getEpoch();
    const refreshToken = await tokenStorage.getRefreshToken();

    if (!refreshToken) return null;
    if (!API_BASE_URL) {
      throw new ApiError(
        "EXPO_PUBLIC_API_URL não configurada",
        0,
        "Configuration Error",
        "CONFIGURATION",
      );
    }

    if (API_URL_REFUSAL) throw refusedApiUrlError(API_URL_REFUSAL);

    const context = this.createRequestContext(
      undefined,
      true,
      DEFAULT_TIMEOUT_MS,
    );

    try {
      logger.dev("apiClient: refreshing access token");
      const response = await fetch(`${API_BASE_URL}/user/refresh-token`, {
        method: "POST",
        headers: { ...clientHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ token: refreshToken }),
        signal: context.signal,
      });

      if (requestEpoch !== this.sessionEpoch) {
        throw createAbortError("Session changed during token refresh");
      }

      if (!response.ok) {
        const errorDetails = await getErrorDetails(response);
        const refreshWasRejected = isTerminalAuthFailure(
          response.status,
          errorDetails.code,
        );

        if (refreshWasRejected) {
          logger.info("apiClient: refresh token rejected");

          // A reuse verdict logs the driver out everywhere; how often that
          // happens on bad networks is exactly what nobody could measure.
          reportEvent("refresh_rejected", {
            code: errorDetails.code,
            status: response.status,
          });

          return null;
        }

        throw new ApiError(
          errorDetails.message,
          response.status,
          response.statusText,
          "HTTP",
          errorDetails.code,
          retryAfterOf(response),
        );
      }

      let data: { token?: string; refresh_token?: string };
      try {
        data = (await response.json()) as typeof data;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new ApiError(
          "Resposta de renovação de sessão inválida",
          502,
          "Invalid Refresh Response",
        );
      }

      if (!data.token || !data.refresh_token) {
        throw new ApiError(
          "Resposta de renovação de sessão inválida",
          502,
          "Invalid Refresh Response",
        );
      }

      if (requestEpoch !== this.sessionEpoch) {
        throw createAbortError("Session changed during token refresh");
      }

      await tokenStorage.setTokens(
        data.token,
        data.refresh_token,
        storageEpoch,
      );

      if (requestEpoch !== this.sessionEpoch) {
        throw createAbortError("Session changed during token refresh");
      }

      await updateSocketAuthToken(data.token);
      logger.info("apiClient: tokens refreshed successfully");

      return data.token;
    } catch (error) {
      return this.normalizeFetchError(error, context);
    } finally {
      context.cleanup();
    }
  }

  async refreshToken(): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise;

    const promise = this.performRefreshToken();
    this.refreshPromise = promise;

    try {
      return await promise;
    } finally {
      if (this.refreshPromise === promise) {
        this.refreshPromise = null;
      }
    }
  }

  async request<T>(
    endpoint: string,
    config: ApiRequestConfig = {},
  ): Promise<T> {
    const {
      method = "GET",
      headers = {},
      body,
      requiresAuth = true,
      signal,
      responseType = "auto",
      timeoutMs = DEFAULT_TIMEOUT_MS,
      authRetryAttempted = false,
    } = config;

    if (!API_BASE_URL) {
      throw new ApiError(
        "EXPO_PUBLIC_API_URL não configurada",
        0,
        "Configuration Error",
        "CONFIGURATION",
      );
    }

    if (API_URL_REFUSAL) throw refusedApiUrlError(API_URL_REFUSAL);

    const requestEpoch = this.sessionEpoch;

    let hasAttemptedAuthRefresh = authRetryAttempted;
    let accessToken = requiresAuth ? await tokenStorage.getAccessToken() : null;

    if (requiresAuth && (!accessToken || isTokenExpired(accessToken))) {
      if (hasAttemptedAuthRefresh) {
        await this.handleUnauthorized();
        throw new ApiError(SESSION_EXPIRED_MESSAGE, 401, "Unauthorized");
      }

      hasAttemptedAuthRefresh = true;
      const refreshedToken = await this.refreshToken();

      if (!refreshedToken) {
        await this.handleUnauthorized();
        throw new ApiError(SESSION_EXPIRED_MESSAGE, 401, "Unauthorized");
      }

      accessToken = refreshedToken;
    }

    if (requiresAuth && requestEpoch !== this.sessionEpoch) {
      throw createAbortError("Session changed before request");
    }

    // Content-Type only when a body actually goes with it: Fastify rejects a
    // JSON content-type with an empty body (400), which silently broke every
    // body-less PATCH — mark-as-read being the visible one.
    const requestHeaders: Record<string, string> = {
      ...clientHeaders(),
      ...headers,
    };

    if (body !== undefined && body !== null) {
      requestHeaders["Content-Type"] = "application/json";
    }

    if (requiresAuth && accessToken) {
      requestHeaders.Authorization = `Bearer ${accessToken}`;
    }

    const requestConfig: RequestInit = { method, headers: requestHeaders };
    if (body !== undefined && body !== null) {
      requestConfig.body = JSON.stringify(body);
    }

    const context = this.createRequestContext(signal, requiresAuth, timeoutMs);
    requestConfig.signal = context.signal;

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, requestConfig);

      // It answered. A 401 or a 403 is still an answer — the banner is about
      // reachability, not about authorisation.
      reportApiReachable(true);

      if (requiresAuth && requestEpoch !== this.sessionEpoch) {
        throw createAbortError("Session changed during request");
      }

      if (!response.ok) {
        const errorDetails = await getErrorDetails(response);

        if (response.status === 401 && requiresAuth) {
          if (!hasAttemptedAuthRefresh) {
            const newAccessToken = await this.refreshToken();
            if (newAccessToken) {
              return this.request<T>(endpoint, {
                ...config,
                requiresAuth: true,
                authRetryAttempted: true,
              });
            }
          }

          await this.handleUnauthorized();

          // A 401 without the API's own words (the proxy, an empty body)
          // is still a session that lapsed, and says so in Portuguese.
          throw new ApiError(
            errorDetails.generic ? SESSION_EXPIRED_MESSAGE : errorDetails.message,
            401,
            "Unauthorized",
            "HTTP",
            errorDetails.code,
          );
        }

        const apiError = new ApiError(
          errorDetails.message,
          response.status,
          response.statusText,
          "HTTP",
          errorDetails.code,
          retryAfterOf(response),
          errorDetails.nonJson,
        );

        // This build is turned away (GAP5-2). Noticed here because any
        // request can meet the gate; the store keeps only the first notice,
        // so the answers that keep coming while the update screen is up do
        // not start it over. The error is still thrown: the caller's failure
        // path, and the outbox's contract class, stay exactly as they were.
        if (isUpgradeRequired(response.status, errorDetails.code)) {
          reportUpgradeRequired({ storeUrl: errorDetails.storeUrl ?? null });
        }

        // Authorization failures (ordinary 403s) must not end a session, but
        // stable security codes such as revocation or an inactive tenant do.
        // This is the HTTP fallback when the real-time security event was
        // missed while the device was offline or suspended.
        if (requiresAuth && apiError.isAuthenticationError) {
          await this.handleUnauthorized();
        }

        throw apiError;
      }

      if (response.status === 204) return undefined as T;
      if (responseType === "text") return (await response.text()) as T;

      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        try {
          return (await response.json()) as T;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw error;
          }
          throw new ApiError(
            "O servidor retornou uma resposta JSON inválida",
            502,
            "Invalid JSON Response",
          );
        }
      }

      return response as unknown as T;
    } catch (error) {
      return this.normalizeFetchError(error, context);
    } finally {
      context.cleanup();
    }
  }

  async get<T>(endpoint: string, requiresAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: "GET", requiresAuth });
  }

  async post<T>(
    endpoint: string,
    body?: unknown,
    requiresAuth = true,
  ): Promise<T> {
    return this.request<T>(endpoint, { method: "POST", body, requiresAuth });
  }

  async put<T>(
    endpoint: string,
    body?: unknown,
    requiresAuth = true,
  ): Promise<T> {
    return this.request<T>(endpoint, { method: "PUT", body, requiresAuth });
  }

  async delete<T>(endpoint: string, requiresAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE", requiresAuth });
  }

  async getNDJSONResponse(
    endpoint: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.request<string>(endpoint, {
      method: "GET",
      requiresAuth: true,
      signal,
      responseType: "text",
      headers: { "Accept-Encoding": "gzip" },
      timeoutMs: 30_000,
    });
  }
}

const apiClient = new ApiClient();

/**
 * Hands the socket the app's one and only refresher.
 *
 * Registered rather than imported the other way around, because `socket.ts`
 * cannot import this module — it is imported BY it. Going through
 * `apiClient.refreshToken` is what keeps the guarantee that matters: the API
 * rotates refresh tokens and reads a reused one as replay, revoking every
 * session on the account, so there may only ever be one refresh in flight.
 */
setSocketTokenRefresher(() => apiClient.refreshToken());

export { apiClient };
