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
  UserMeResponse,
} from "../types";

import { tokenStorage, asyncStorage } from "../utils/storage";
import { logger } from "../utils/logger";

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
            false, // No auth required for login
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
          const userMeResponse =
            await apiClient.get<UserMeResponse>("/user/me");
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
              case "driver_inactive":
                errorMessage =
                  "Seu cadastro como motorista está inativo. Entre em contato com o administrador.";
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
            false, // No auth required for two-factor verification
          );

          // Store tokens first
          const { token, refresh_token } = response;
          await tokenStorage.setTokens(token, refresh_token);

          // Now fetch complete user data using the token
          const userMeResponse =
            await apiClient.get<UserMeResponse>("/user/me");
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
              case "driver_inactive":
                errorMessage =
                  "Seu cadastro como motorista está inativo. Entre em contato com o administrador.";
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
            false, // No auth required for resend
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
          logger.dev("🔄 auth-store: Delegating refresh to apiClient...");

          // ✅ Delegate to apiClient which has the complete refresh logic
          const newAccessToken = await apiClient.refreshToken();

          if (!newAccessToken) {
            logger.info("❌ auth-store: Token refresh failed");
            throw new Error("Token refresh failed");
          }

          // Get the new refresh token from storage (apiClient already saved it)
          const newRefreshToken = await tokenStorage.getRefreshToken();

          // Update store state with new tokens
          set({
            tokens: {
              accessToken: newAccessToken,
              refreshToken: newRefreshToken || "",
            },
          });

          logger.info("✅ auth-store: Tokens refreshed successfully");
          return true;
        } catch {
          logger.error("❌ auth-store: Token refresh failed");

          // Clear tokens and logout
          logger.dev("🧹 auth-store: Clearing tokens and logging out...");
          await get().logout();
          return false;
        }
      },
      checkAuth: async () => {
        set({ isLoading: true });

        try {
          const accessToken = await tokenStorage.getAccessToken();
          const refreshToken = await tokenStorage.getRefreshToken();

          logger.dev("🔐 checkAuth: Checking tokens...", {
            hasAccessToken: !!accessToken,
            hasRefreshToken: !!refreshToken,
          });

          // If no tokens, just mark as initialized and return (user will see login screen)
          if (!accessToken || !refreshToken) {
            logger.info("🔐 checkAuth: No tokens found");
            set({ isLoading: false, isInitialized: true });
            return;
          }

          // ✅ DON'T manually check expiration or refresh here!
          // Let apiClient.get() handle token refresh automatically
          logger.dev("🔐 checkAuth: Fetching user data...");

          try {
            const response = await apiClient.get<{ user: User }>("/user/me");
            const { user } = response;

            logger.dev("🔐 checkAuth: User data received");

            // Validate user access
            const accessValidation = validateUserAccess(user);
            if (!accessValidation.hasAccess) {
              logger.info("🔐 checkAuth: User access denied");
              await get().logout();
              set({ isLoading: false, isInitialized: true });
              return;
            }

            // Get fresh tokens from storage (apiClient may have refreshed them)
            const freshAccessToken = await tokenStorage.getAccessToken();
            const freshRefreshToken = await tokenStorage.getRefreshToken();

            // Update store with fresh user data and tokens
            set({
              user,
              tokens: {
                accessToken: freshAccessToken || "",
                refreshToken: freshRefreshToken || "",
              },
              isAuthenticated: true,
              isLoading: false,
              isInitialized: true,
            });

            logger.info("✅ checkAuth: Authentication successful");
          } catch (error) {
            // ✅ Silently handle session expiration (401) - don't log as error
            if (error instanceof ApiError && error.status === 401) {
              logger.info("🔒 checkAuth: Session expired");
            } else {
              logger.error("❌ checkAuth: Unexpected error");
            }

            // If any error occurs (including 401 after refresh attempts), logout silently
            await get().logout();
            set({ isLoading: false, isInitialized: true });
          }
        } catch (error) {
          // ✅ Outer catch: only log truly unexpected errors
          if (error instanceof ApiError && error.status === 401) {
            logger.info("🔒 checkAuth: Session expired");
          } else {
            logger.error("❌ checkAuth: Critical error");
          }
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
    },
  ),
);
