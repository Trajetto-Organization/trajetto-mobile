import { tokenStorage } from "./storage";
import { isTokenExpired } from "./jwt";

import { logger } from "./logger";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiRequestConfig {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: any;
  requiresAuth?: boolean;
  signal?: AbortSignal;
  returnRawResponse?: boolean; // For NDJSON streaming
}

class ApiClient {
  private isRefreshing = false;
  private refreshPromise: Promise<string | null> | null = null; // 🔒 Shared promise to prevent duplicate calls

  private refreshSubscribers: Array<(token: string) => void> = [];
  private logoutCallback: (() => void) | null = null;

  private addRefreshSubscriber(callback: (token: string) => void) {
    this.refreshSubscribers.push(callback);
  }

  private onRefreshed(token: string) {
    this.refreshSubscribers.forEach((callback) => callback(token));
    this.refreshSubscribers = [];
  }

  // Method to set logout callback (will be called from authStore)
  setLogoutCallback(callback: () => void) {
    this.logoutCallback = callback;
  }

  private handleUnauthorized() {
    if (this.logoutCallback) {
      this.logoutCallback();
    }
  }

  async refreshToken(): Promise<string | null> {
    // 🔒 If already refreshing, return the existing promise
    if (this.refreshPromise) {
      logger.dev("⏳ apiClient: Refresh already in progress, waiting...");
      return this.refreshPromise;
    }

    // Create a new refresh promise
    this.refreshPromise = (async () => {
      try {
        logger.dev("🔄 apiClient: Starting token refresh...");
        const refreshToken = await tokenStorage.getRefreshToken();

        if (!refreshToken) {
          logger.info("❌ apiClient: No refresh token found");
          throw new Error("No refresh token available");
        }

        // ✅ DON'T check if refresh token is expired here!
        // Let the BACKEND validate expiration. If expired, backend will return error.
        // This allows the backend to decide refresh token validity (not the client).
        logger.dev("📤 apiClient: Sending refresh request to backend...");
        const response = await fetch(`${API_BASE_URL}/user/refresh-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: refreshToken }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.message || `HTTP ${response.status}`;

          // ✅ Only log as error if it's NOT a token expiration (those are expected)
          if (
            response.status === 401 ||
            errorMessage.includes("inválida") ||
            errorMessage.includes("não existe")
          ) {
            logger.info("🔒 apiClient: Refresh token expired");
          } else {
            logger.error("❌ apiClient: Refresh failed");
          }

          throw new Error(`Failed to refresh token: ${errorMessage}`);
        }

        const data = await response.json();
        const { token: newAccessToken, refresh_token: newRefreshToken } = data;

        logger.info("✅ apiClient: Tokens refreshed successfully");
        await tokenStorage.setTokens(newAccessToken, newRefreshToken);

        return newAccessToken;
      } catch (error) {
        // ✅ Only log as error if it's NOT an expected token expiration
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("inválida") ||
          errorMessage.includes("não existe") ||
          errorMessage.includes("expired")
        ) {
          logger.info("🔒 apiClient: Token expired, clearing session");
        } else {
          logger.error("❌ apiClient: Token refresh failed");
        }

        logger.dev("🧹 apiClient: Clearing tokens...");
        await tokenStorage.clearTokens();
        return null;
      } finally {
        // ✅ Clear the promise after completion (success or failure)
        logger.dev("🔓 apiClient: Refresh completed");
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
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
      returnRawResponse = false,
    } = config;

    let accessToken = requiresAuth ? await tokenStorage.getAccessToken() : null;

    // Check if token needs refresh
    if (requiresAuth && accessToken && isTokenExpired(accessToken)) {
      if (this.isRefreshing) {
        // Wait for the refresh to complete
        return new Promise((resolve, reject) => {
          this.addRefreshSubscriber(async (newToken: string) => {
            try {
              const result = await this.request<T>(endpoint, {
                ...config,
                requiresAuth: true,
              });
              resolve(result);
            } catch (error) {
              reject(error);
            }
          });
        });
      }

      this.isRefreshing = true;
      try {
        accessToken = await this.refreshToken();
        this.onRefreshed(accessToken || "");
      } finally {
        this.isRefreshing = false;
      }

      if (!accessToken) {
        this.handleUnauthorized();
        throw new ApiError("Authentication failed", 401, "Unauthorized");
      }
    }

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    };

    if (requiresAuth && accessToken) {
      requestHeaders.Authorization = `Bearer ${accessToken}`;
    }

    const requestConfig: RequestInit = {
      method,
      headers: requestHeaders,
      signal,
    };

    if (body) {
      if (body instanceof FormData) {
        // Remove Content-Type for FormData to let browser set it with boundary
        delete requestHeaders["Content-Type"];
        requestConfig.body = body;
      } else {
        requestConfig.body = JSON.stringify(body);
      }
    }

    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, requestConfig);

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          // If response is not JSON, use the default error message
        }

        // ✅ Handle 401 Unauthorized - try to refresh token ONCE before giving up
        if (response.status === 401 && requiresAuth) {
          logger.dev("⚠️ apiClient: Received 401, attempting token refresh...");

          // Try to refresh token
          const newAccessToken = await this.refreshToken();

          if (newAccessToken) {
            logger.dev("🔄 apiClient: Retrying request with new token...");
            // Retry the request with new token (recursive call, will only retry once)
            return this.request<T>(endpoint, { ...config, requiresAuth: true });
          }

          // If refresh failed, logout and throw a silent error (user will be redirected to login)
          logger.info("🔒 apiClient: Session expired");
          this.handleUnauthorized();
          // Don't throw error - just return a rejected promise silently
          throw new ApiError("Session expired", 401, "Unauthorized");
        }

        throw new ApiError(errorMessage, response.status, response.statusText);
      }

      // Return raw response for NDJSON streaming
      if (returnRawResponse) {
        return response as unknown as T;
      }

      // Handle different content types
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        return await response.json();
      } else {
        return response as unknown as T;
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(
        error instanceof Error ? error.message : "Network error",
        0,
        "Network Error",
      );
    }
  }

  // Convenience methods
  async get<T>(endpoint: string, requiresAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: "GET", requiresAuth });
  }

  async post<T>(endpoint: string, body?: any, requiresAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: "POST", body, requiresAuth });
  }

  async put<T>(endpoint: string, body?: any, requiresAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: "PUT", body, requiresAuth });
  }

  async delete<T>(endpoint: string, requiresAuth = true): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE", requiresAuth });
  }

  // Special method for FormData (multipart/form-data)
  async postFormData<T>(
    endpoint: string,
    formData: FormData,
    requiresAuth = true,
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: formData,
      requiresAuth,
      headers: {}, // Let browser set Content-Type for FormData
    });
  }

  // Special method for NDJSON streaming with automatic token refresh
  async getNDJSONResponse(
    endpoint: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.request<Response>(endpoint, {
      method: "GET",
      requiresAuth: true,
      signal,
      returnRawResponse: true,
      headers: {
        "Accept-Encoding": "gzip",
      },
    });
  }
}

export const apiClient = new ApiClient();
export default apiClient;
