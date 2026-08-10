import { isTokenExpired } from "./jwt";
import { logger } from "./logger";

import { updateSocketAuthToken } from "./socket";
import { tokenStorage } from "./storage";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "");

const DEFAULT_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export type ApiErrorCategory = "HTTP" | "NETWORK" | "TIMEOUT" | "CONFIGURATION";

const TERMINAL_AUTH_ERROR_CODES = new Set([
  "AUTH_ACCESS_REVOKED",
  "AUTH_BRANCH_INACTIVE",
  "AUTH_BUSINESS_INACTIVE",
  "AUTH_BUSINESS_REQUIRED",
  "AUTH_DRIVER_INACTIVE",
  "AUTH_DRIVER_TENANT_MISMATCH",
  "AUTH_PROFILE_NOT_CONFIGURED",
  "AUTH_REFRESH_INVALID",
  "AUTH_REFRESH_REUSED",
  "AUTH_SESSION_INVALID",
  "AUTH_SESSION_INVALIDATED",
  "AUTH_TOKEN_INVALID",
  "AUTH_TOKEN_MISSING",
]);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
    public category: ApiErrorCategory = "HTTP",
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isAuthenticationError(): boolean {
    return (
      this.status === 401 ||
      (this.code !== undefined && TERMINAL_AUTH_ERROR_CODES.has(this.code))
    );
  }

  get isTransient(): boolean {
    return (
      this.category === "NETWORK" ||
      this.category === "TIMEOUT" ||
      this.status === 408 ||
      this.status === 429 ||
      this.status >= 500
    );
  }
}

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

export interface ApiUploadOptions {
  requiresAuth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
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
  code?: string;
}

const getErrorDetails = async (
  response: Response,
): Promise<ApiErrorDetails> => {
  const fallback = `HTTP ${response.status}: ${response.statusText}`;
  try {
    const errorData = (await response.json()) as {
      message?: string;
      code?: string;
      error?: string | { message?: string; code?: string };
    };
    const nestedError =
      typeof errorData.error === "object" ? errorData.error : undefined;
    return {
      message:
        errorData.message ||
        nestedError?.message ||
        (typeof errorData.error === "string" ? errorData.error : fallback),
      code:
        errorData.code ||
        nestedError?.code ||
        response.headers.get("x-error-code") ||
        undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return {
      message: fallback,
      code: response.headers.get("x-error-code") || undefined,
    };
  }
};

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
      throw new ApiError(
        "A requisicao excedeu o tempo limite. Tente novamente.",
        0,
        "Request Timeout",
        "TIMEOUT",
      );
    }

    if (error instanceof Error && error.name === "AbortError") throw error;
    if (context.signal.aborted) {
      throw createAbortError();
    }

    throw new ApiError(
      error instanceof Error ? error.message : "Network error",
      0,
      "Network Error",
      "NETWORK",
    );
  }

  private async performRefreshToken(): Promise<string | null> {
    const requestEpoch = this.sessionEpoch;

    const storageEpoch = tokenStorage.getEpoch();
    const refreshToken = await tokenStorage.getRefreshToken();

    if (!refreshToken) return null;
    if (!API_BASE_URL) {
      throw new ApiError(
        "EXPO_PUBLIC_API_URL nao configurada",
        0,
        "Configuration Error",
        "CONFIGURATION",
      );
    }

    const context = this.createRequestContext(
      undefined,
      true,
      DEFAULT_TIMEOUT_MS,
    );

    try {
      logger.dev("apiClient: refreshing access token");
      const response = await fetch(`${API_BASE_URL}/user/refresh-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: refreshToken }),
        signal: context.signal,
      });

      if (requestEpoch !== this.sessionEpoch) {
        throw createAbortError("Session changed during token refresh");
      }

      if (!response.ok) {
        const errorDetails = await getErrorDetails(response);
        const refreshWasRejected =
          response.status === 401 ||
          (errorDetails.code !== undefined &&
            TERMINAL_AUTH_ERROR_CODES.has(errorDetails.code));

        if (refreshWasRejected) {
          logger.info("apiClient: refresh token rejected");
          return null;
        }

        throw new ApiError(
          errorDetails.message,
          response.status,
          response.statusText,
          "HTTP",
          errorDetails.code,
        );
      }

      let data: { token?: string; refresh_token?: string };
      try {
        data = (await response.json()) as typeof data;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new ApiError(
          "Resposta de renovacao de sessao invalida",
          502,
          "Invalid Refresh Response",
        );
      }

      if (!data.token || !data.refresh_token) {
        throw new ApiError(
          "Resposta de renovacao de sessao invalida",
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
        "EXPO_PUBLIC_API_URL nao configurada",
        0,
        "Configuration Error",
        "CONFIGURATION",
      );
    }

    const requestEpoch = this.sessionEpoch;

    let hasAttemptedAuthRefresh = authRetryAttempted;
    let accessToken = requiresAuth ? await tokenStorage.getAccessToken() : null;

    if (requiresAuth && (!accessToken || isTokenExpired(accessToken))) {
      if (hasAttemptedAuthRefresh) {
        await this.handleUnauthorized();
        throw new ApiError("Session expired", 401, "Unauthorized");
      }

      hasAttemptedAuthRefresh = true;
      const refreshedToken = await this.refreshToken();

      if (!refreshedToken) {
        await this.handleUnauthorized();
        throw new ApiError("Session expired", 401, "Unauthorized");
      }

      accessToken = refreshedToken;
    }

    if (requiresAuth && requestEpoch !== this.sessionEpoch) {
      throw createAbortError("Session changed before request");
    }

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    };
    if (requiresAuth && accessToken) {
      requestHeaders.Authorization = `Bearer ${accessToken}`;
    }

    const requestConfig: RequestInit = { method, headers: requestHeaders };
    if (body !== undefined && body !== null) {
      if (body instanceof FormData) {
        delete requestHeaders["Content-Type"];
        requestConfig.body = body;
      } else {
        requestConfig.body = JSON.stringify(body);
      }
    }

    const context = this.createRequestContext(signal, requiresAuth, timeoutMs);
    requestConfig.signal = context.signal;

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, requestConfig);
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
          throw new ApiError(
            errorDetails.message || "Session expired",
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
        );

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
            "O servidor retornou uma resposta JSON invalida",
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

  async postFormData<T>(
    endpoint: string,
    formData: FormData,
    requiresAuthOrOptions: boolean | ApiUploadOptions = true,
    options: ApiUploadOptions = {},
  ): Promise<T> {
    const uploadOptions =
      typeof requiresAuthOrOptions === "boolean"
        ? options
        : requiresAuthOrOptions;
    const requiresAuth =
      typeof requiresAuthOrOptions === "boolean"
        ? requiresAuthOrOptions
        : (requiresAuthOrOptions.requiresAuth ?? true);

    return this.request<T>(endpoint, {
      method: "POST",
      body: formData,
      requiresAuth,
      headers: uploadOptions.headers,
      signal: uploadOptions.signal,
      timeoutMs: uploadOptions.timeoutMs ?? UPLOAD_TIMEOUT_MS,
    });
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
export { apiClient };
