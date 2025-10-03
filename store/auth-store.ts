import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AuthState,
  User,
  LoginResponse,
  TwoFactorRequiredResponse,
  EmailVerificationResponse,
  TwoFactorVerificationResponse,
  RefreshTokenResponse,
  UserMeResponse,
} from "../types";

import { tokenStorage, asyncStorage } from "../utils/storage";
import { isTokenExpired } from "../utils/jwt";

import { validateUserAccess } from "../utils/permissions";
import apiClient, { ApiError } from "../utils/api";

import { queryClient } from "../providers/query-provider";

interface AuthStore extends AuthState {
  // Additional internal state
  isInitialized: boolean;
  setInitialized: (initialized: boolean) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false,

      setInitialized: (initialized: boolean) => {
        set({ isInitialized: initialized });

        // Configure apiClient logout callback when store is initialized
        apiClient.setLogoutCallback(() => {
          get().logout();
        });
      },

      setUser: (user: User) => {
        set({ user });
      },

      login: async (email: string, password: string) => {
        set({ isLoading: true });

        try {
          const response = await apiClient.post<
            | LoginResponse
            | TwoFactorRequiredResponse
            | EmailVerificationResponse
          >(
            "/user/session",
            { email, password },
            false // No auth required for login
          );

          set({ isLoading: false });

          // Check if email verification is required
          if ("emailVerification" in response && response.emailVerification) {
            return {
              success: false,
              requiresEmailVerification: true,
              email: email,
              error: response.message,
            };
          }

          // Check if two-factor authentication is required
          if (
            "twoFactorVerification" in response &&
            response.twoFactorVerification
          ) {
            return {
              success: false,
              requiresTwoFactor: true,
              email: email,
              error: response.message,
            };
          }

          // If we get here, it's a normal login response
          const loginResponse = response as LoginResponse;

          // Store tokens first
          const { token, refresh_token } = loginResponse;
          await tokenStorage.setTokens(token, refresh_token);

          // Now fetch complete user data using the token
          const userMeResponse = await apiClient.get<UserMeResponse>(
            "/user/me"
          );
          const user = userMeResponse.user;

          // Validate user access
          const accessValidation = validateUserAccess(user);
          if (!accessValidation.hasAccess) {
            let errorMessage = "Acesso negado.";

            switch (accessValidation.reason) {
              case "access_revoked":
                errorMessage =
                  "Seu acesso foi revogado. Entre em contato com o administrador.";
                break;
              case "no_permissions":
                errorMessage =
                  "Você não possui permissões configuradas. Entre em contato com o administrador.";
                break;
              case "no_vehicle_permission":
                errorMessage =
                  "Você não possui permissão para visualizar veículos. Entre em contato com o administrador.";
                break;
              default:
                errorMessage =
                  "Acesso negado. Entre em contato com o administrador.";
            }

            return { success: false, error: errorMessage };
          }

          // Update store state
          set({
            user,
            tokens: { accessToken: token, refreshToken: refresh_token },
            isAuthenticated: true,
            isLoading: false,
          });

          return { success: true };
        } catch (error) {
          set({ isLoading: false });

          if (error instanceof ApiError) {
            return {
              success: false,
              error: error.message || "Erro ao fazer login",
            };
          }

          return {
            success: false,
            error: "Erro de rede. Verifique sua conexão.",
          };
        }
      },

      verifyTwoFactor: async (email: string, code: string) => {
        set({ isLoading: true });

        try {
          const response = await apiClient.post<TwoFactorVerificationResponse>(
            "/user/two-factor-verification",
            { email, code },
            false // No auth required for two-factor verification
          );

          // Store tokens first
          const { token, refresh_token } = response;
          await tokenStorage.setTokens(token, refresh_token);

          // Now fetch complete user data using the token
          const userMeResponse = await apiClient.get<UserMeResponse>(
            "/user/me"
          );
          const user = userMeResponse.user;

          // Validate user access
          const accessValidation = validateUserAccess(user);
          if (!accessValidation.hasAccess) {
            let errorMessage = "Acesso negado.";

            switch (accessValidation.reason) {
              case "access_revoked":
                errorMessage =
                  "Seu acesso foi revogado. Entre em contato com o administrador.";
                break;
              case "no_permissions":
                errorMessage =
                  "Você não possui permissões configuradas. Entre em contato com o administrador.";
                break;
              case "no_vehicle_permission":
                errorMessage =
                  "Você não possui permissão para visualizar veículos. Entre em contato com o administrador.";
                break;
              default:
                errorMessage =
                  "Acesso negado. Entre em contato com o administrador.";
            }

            return { success: false, error: errorMessage };
          }

          // Update store state
          set({
            user,
            tokens: { accessToken: token, refreshToken: refresh_token },
            isAuthenticated: true,
            isLoading: false,
          });

          return { success: true };
        } catch (error) {
          set({ isLoading: false });

          if (error instanceof ApiError) {
            return {
              success: false,
              error: error.message || "Código inválido ou expirado",
            };
          }

          return {
            success: false,
            error: "Erro de rede. Verifique sua conexão.",
          };
        }
      },

      resendTwoFactorCode: async (email: string) => {
        try {
          // Call the resend two-factor code endpoint
          await apiClient.post(
            "/user/resend-two-factor-code",
            { email },
            false // No auth required for resend
          );

          return { success: true };
        } catch (error) {
          if (error instanceof ApiError) {
            return {
              success: false,
              error: error.message || "Erro ao reenviar código",
            };
          }

          return {
            success: false,
            error: "Erro de rede. Verifique sua conexão.",
          };
        }
      },

      logout: async () => {
        try {
          // Clear tokens from secure storage
          await tokenStorage.clearTokens();

          // Clear user data from async storage
          await asyncStorage.clear();

          // Clear all React Query cache
          queryClient.clear();

          // Reset store state
          set({
            user: null,
            tokens: null,
            isAuthenticated: false,
            isLoading: false,
          });
        } catch (error) {
          console.error("Error during logout:", error);
          // Even if there's an error, reset the state and clear cache
          queryClient.clear();
          set({
            user: null,
            tokens: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },

      refreshToken: async () => {
        try {
          const refreshToken = await tokenStorage.getRefreshToken();
          if (!refreshToken) {
            throw new Error("No refresh token available");
          }

          const response = await apiClient.post<RefreshTokenResponse>(
            "/user/refresh-token",
            { token: refreshToken },
            false // No auth required for refresh
          );

          const { token: newAccessToken, refresh_token: newRefreshToken } =
            response;

          // Store new tokens
          await tokenStorage.setTokens(newAccessToken, newRefreshToken);

          // Update store state
          set({
            tokens: {
              accessToken: newAccessToken,
              refreshToken: newRefreshToken,
            },
          });

          return true;
        } catch (error) {
          console.error("Token refresh failed:", error);

          // If refresh fails, logout the user
          await get().logout();
          return false;
        }
      },

      checkAuth: async () => {
        set({ isLoading: true });

        try {
          const accessToken = await tokenStorage.getAccessToken();
          const refreshToken = await tokenStorage.getRefreshToken();

          if (!accessToken || !refreshToken) {
            set({ isLoading: false, isInitialized: true });
            return;
          }

          // Check if access token is expired
          if (isTokenExpired(accessToken)) {
            const refreshSuccess = await get().refreshToken();
            if (!refreshSuccess) {
              set({ isLoading: false, isInitialized: true });
              return;
            }
          }

          // Fetch user data to verify the session is still valid
          try {
            const response = await apiClient.get<{ user: User }>("/user/me");
            const { user } = response;

            // Validate user access
            const accessValidation = validateUserAccess(user);
            if (!accessValidation.hasAccess) {
              await get().logout();
              set({ isLoading: false, isInitialized: true });
              return;
            }

            // Update store with fresh user data
            const currentTokens = get().tokens;
            set({
              user,
              tokens: currentTokens || {
                accessToken: accessToken,
                refreshToken: refreshToken,
              },
              isAuthenticated: true,
              isLoading: false,
              isInitialized: true,
            });
          } catch (error) {
            // If user fetch fails, try to refresh token once more
            if (error instanceof ApiError && error.status === 401) {
              const refreshSuccess = await get().refreshToken();
              if (refreshSuccess) {
                // Retry fetching user data
                try {
                  const response = await apiClient.get<{ user: User }>(
                    "/user/me"
                  );
                  const { user } = response;

                  const accessValidation = validateUserAccess(user);
                  if (!accessValidation.hasAccess) {
                    await get().logout();
                    set({ isLoading: false, isInitialized: true });
                    return;
                  }

                  set({
                    user,
                    isAuthenticated: true,
                    isLoading: false,
                    isInitialized: true,
                  });
                } catch {
                  await get().logout();
                  set({ isLoading: false, isInitialized: true });
                }
              } else {
                await get().logout();
                set({ isLoading: false, isInitialized: true });
              }
            } else {
              await get().logout();
              set({ isLoading: false, isInitialized: true });
            }
          }
        } catch (error) {
          await get().logout();
          set({ isLoading: false, isInitialized: true });
        }
      },
    }),
    {
      name: "auth-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        // Only persist user data, not tokens (they're stored securely)
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
