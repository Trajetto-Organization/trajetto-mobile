import { tokenStorage } from "./storage";
import { isTokenExpired } from "./jwt";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string
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
    try {
      const refreshToken = await tokenStorage.getRefreshToken();
      if (!refreshToken) {
        throw new Error("No refresh token available");
      }

      const response = await fetch(`${API_BASE_URL}/user/refresh-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: refreshToken }),
      });

      if (!response.ok) {
        throw new Error("Failed to refresh token");
      }

      const data = await response.json();
      const { token: newAccessToken, refresh_token: newRefreshToken } = data;

      await tokenStorage.setTokens(newAccessToken, newRefreshToken);
      return newAccessToken;
    } catch (error) {
      await tokenStorage.clearTokens();
      return null;
    }
  }

  async request<T>(
    endpoint: string,
    config: ApiRequestConfig = {}
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

        // Handle 401 Unauthorized - force logout
        if (response.status === 401 && requiresAuth) {
          this.handleUnauthorized();
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
        "Network Error"
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

  // Special method for NDJSON streaming with automatic token refresh
  async getNDJSONResponse(
    endpoint: string,
    signal?: AbortSignal
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
