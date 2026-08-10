import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { clearQueryCache } from "../providers/query-provider";
import {
  clearAllSubmissionData,
  disableSubmissionPersistence,
  enableSubmissionPersistence,
} from "../features/submissions/submission-id";
import type {
  AuthState,
  EmailVerificationResponse,
  LoginResponse,
  TwoFactorRequiredResponse,
  TwoFactorVerificationResponse,
  User,
  UserMeResponse,
} from "../types";
import { ApiError, apiClient } from "../utils/api";
import { logger } from "../utils/logger";
import { validateUserAccess } from "../utils/permissions";
import { disconnectSocket } from "../utils/socket";
import { authSessionStorage, tokenStorage } from "../utils/storage";

type AuthenticationResult = {
  success: boolean;
  error?: string;
  requiresTwoFactor?: boolean;
  requiresEmailVerification?: boolean;
  email?: string;
};

let authOperationEpoch = 0;
let logoutPromise: Promise<void> | null = null;
let logoutOperationEpoch: number | null = null;
let checkAuthPromise: Promise<void> | null = null;
let checkAuthOperationEpoch: number | null = null;

const beginAuthOperation = (): number => {
  authOperationEpoch += 1;
  return authOperationEpoch;
};

const isCurrentOperation = (operationEpoch: number): boolean =>
  operationEpoch === authOperationEpoch;

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const mergeServerUser = (serverUser: User, cachedUser: User | null): User => {
  if (
    serverUser.role === "MASTER" &&
    cachedUser?.role === "MASTER" &&
    cachedUser.businessId &&
    !serverUser.businessId
  ) {
    return {
      ...serverUser,
      businessId: cachedUser.businessId,
      selectedBusiness: cachedUser.selectedBusiness,
    };
  }
  return serverUser;
};

const getAccessErrorMessage = (reason?: string): string => {
  switch (reason) {
    case "session_expired":
      return "Sua sessao expirou. Faca login novamente.";
    case "session_not_renewed":
      return "Nao foi possivel renovar sua sessao. Faca login novamente.";
    case "access_revoked":
      return "Seu acesso foi revogado. Entre em contato com o administrador.";
    case "driver_inactive":
      return "Seu cadastro como motorista esta inativo. Entre em contato com o administrador.";
    case "no_permissions":
      return "Usuario sem perfil de acesso ou permissoes configuradas.";
    case "no_vehicle_permission":
      return "Voce nao possui permissao para visualizar veiculos.";
    case "access_denied":
      return "Sua conta foi excluida ou nao esta autorizada.";
    case "permissions_changed":
      return "Suas permissoes foram atualizadas. Faca login novamente.";
    default:
      return "Acesso negado. Entre em contato com o administrador.";
  }
};

const getAuthenticationErrorMessage = (
  error: unknown,
  fallback: string,
): string => {
  if (isAbortError(error)) return "Operacao cancelada.";
  if (error instanceof ApiError) {
    if (error.category === "NETWORK") {
      return "Erro de rede. Verifique sua conexao.";
    }
    return error.message || fallback;
  }
  return fallback;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      const setUnauthenticated = (initialized = true): void => {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialized: initialized,
        });
      };

      const rejectStagedSession = async (
        operationEpoch: number,
      ): Promise<void> => {
        if (!isCurrentOperation(operationEpoch)) return;

        apiClient.invalidateSession();
        tokenStorage.invalidate();
        const markerEpoch = authSessionStorage.invalidate();
        disableSubmissionPersistence();
        disconnectSocket(false);
        setUnauthenticated(true);

        await Promise.allSettled([
          authSessionStorage.markLoggedOut(markerEpoch),
          tokenStorage.clearTokens(),
          clearAllSubmissionData(),
          clearQueryCache(),
        ]);
      };

      const establishSession = async (
        accessToken: string,
        refreshToken: string,
        operationEpoch: number,
        storageEpoch: number,
        markerEpoch: number,
      ): Promise<AuthenticationResult> => {
        let tokensWereStaged = false;

        try {
          await tokenStorage.setTokens(
            accessToken,
            refreshToken,
            storageEpoch,
          );
          tokensWereStaged = true;

          if (!isCurrentOperation(operationEpoch)) {
            throw Object.assign(new Error("Authentication superseded"), {
              name: "AbortError",
            });
          }

          const userMeResponse =
            await apiClient.get<UserMeResponse>("/user/me");
          const user = userMeResponse.user;
          const accessValidation = validateUserAccess(user);

          if (!accessValidation.hasAccess) {
            await rejectStagedSession(operationEpoch);
            return {
              success: false,
              error: getAccessErrorMessage(accessValidation.reason),
            };
          }

          if (!isCurrentOperation(operationEpoch)) {
            throw Object.assign(new Error("Authentication superseded"), {
              name: "AbortError",
            });
          }

          await authSessionStorage.markActive(markerEpoch);
          if (!isCurrentOperation(operationEpoch)) {
            throw Object.assign(new Error("Authentication superseded"), {
              name: "AbortError",
            });
          }

          enableSubmissionPersistence();
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            isInitialized: true,
          });
          return { success: true };
        } catch (error) {
          if (tokensWereStaged && isCurrentOperation(operationEpoch)) {
            await rejectStagedSession(operationEpoch);
          }
          return {
            success: false,
            error: getAuthenticationErrorMessage(
              error,
              "Nao foi possivel concluir a autenticacao.",
            ),
          };
        }
      };

      return {
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isInitialized: false,

        setUser: (user: User) => set({ user }),
        setServerUser: (user: User) =>
          set((state) => ({ user: mergeServerUser(user, state.user) })),

        login: async (email, password) => {
          const operationEpoch = beginAuthOperation();
          apiClient.invalidateSession();
          const storageEpoch = tokenStorage.invalidate();
          const markerEpoch = authSessionStorage.invalidate();
          set({ isLoading: true });

          try {
            const response = await apiClient.post<
              | LoginResponse
              | TwoFactorRequiredResponse
              | EmailVerificationResponse
            >("/user/session", { email, password }, false);

            if (!isCurrentOperation(operationEpoch)) {
              return { success: false, error: "Operacao cancelada." };
            }

            if ("emailVerification" in response && response.emailVerification) {
              return {
                success: false,
                requiresEmailVerification: true,
                email,
                error: response.message,
              };
            }

            if (
              "twoFactorVerification" in response &&
              response.twoFactorVerification
            ) {
              return {
                success: false,
                requiresTwoFactor: true,
                email,
                error: response.message,
              };
            }

            const loginResponse = response as LoginResponse;
            return establishSession(
              loginResponse.token,
              loginResponse.refresh_token,
              operationEpoch,
              storageEpoch,
              markerEpoch,
            );
          } catch (error) {
            return {
              success: false,
              error: getAuthenticationErrorMessage(
                error,
                "Erro ao fazer login.",
              ),
            };
          } finally {
            if (isCurrentOperation(operationEpoch)) {
              set({ isLoading: false });
            }
          }
        },

        verifyTwoFactor: async (email, code) => {
          const operationEpoch = beginAuthOperation();
          apiClient.invalidateSession();
          const storageEpoch = tokenStorage.invalidate();
          const markerEpoch = authSessionStorage.invalidate();
          set({ isLoading: true });

          try {
            const response =
              await apiClient.post<TwoFactorVerificationResponse>(
                "/user/two-factor-verification",
                { email, code },
                false,
              );

            if (!isCurrentOperation(operationEpoch)) {
              return { success: false, error: "Operacao cancelada." };
            }

            return establishSession(
              response.token,
              response.refresh_token,
              operationEpoch,
              storageEpoch,
              markerEpoch,
            );
          } catch (error) {
            return {
              success: false,
              error: getAuthenticationErrorMessage(
                error,
                "Codigo invalido ou expirado.",
              ),
            };
          } finally {
            if (isCurrentOperation(operationEpoch)) {
              set({ isLoading: false });
            }
          }
        },

        resendTwoFactorCode: async (email) => {
          try {
            await apiClient.post(
              "/user/resend-two-factor-code",
              { email },
              false,
            );
            return { success: true };
          } catch (error) {
            return {
              success: false,
              error: getAuthenticationErrorMessage(
                error,
                "Erro ao reenviar codigo.",
              ),
            };
          }
        },

        logout: async () => {
          if (
            logoutPromise &&
            logoutOperationEpoch !== null &&
            logoutOperationEpoch === authOperationEpoch
          ) {
            return logoutPromise;
          }

          // Capture the access token before local cleanup. This request does
          // not participate in authenticated-request cancellation, so the
          // server can revoke every refresh-token family for this user even
          // after the local session epoch is invalidated.
          const serverLogoutPromise = tokenStorage
            .getAccessToken()
            .then((accessToken) => {
              if (!accessToken) return;
              return apiClient.request("/user/logout", {
                method: "POST",
                requiresAuth: false,
                headers: { Authorization: `Bearer ${accessToken}` },
                timeoutMs: 5_000,
              });
            });

          const operationEpoch = beginAuthOperation();
          logoutOperationEpoch = operationEpoch;
          apiClient.invalidateSession();
          tokenStorage.invalidate();
          const markerEpoch = authSessionStorage.invalidate();
          disableSubmissionPersistence();
          disconnectSocket(true);
          setUnauthenticated(true);

          const promise = (async () => {
            const results = await Promise.allSettled([
              serverLogoutPromise,
              authSessionStorage.markLoggedOut(markerEpoch),
              tokenStorage.clearTokens(),
              authSessionStorage.clearPersistedAuth(),
              clearAllSubmissionData(),
              clearQueryCache(),
            ]);
            // The remote call is deliberately best-effort. Local credential
            // cleanup failures are the ones that require diagnostics.
            const failures = results.slice(1).filter(
              (result) => result.status === "rejected",
            );
            if (failures.length > 0) {
              logger.error("logout: one or more storage cleanups failed");
            }
          })();

          logoutPromise = promise;
          try {
            await promise;
          } finally {
            if (logoutPromise === promise) {
              logoutPromise = null;
              logoutOperationEpoch = null;
            }
          }
        },

        refreshToken: async () => {
          try {
            const newAccessToken = await apiClient.refreshToken();
            if (newAccessToken) return true;
            await get().logout();
            return false;
          } catch (error) {
            if (error instanceof ApiError && error.isTransient) {
              logger.info("refreshToken: transient failure, session preserved");
              return false;
            }
            if (!isAbortError(error)) await get().logout();
            return false;
          }
        },

        checkAuth: async (options = {}) => {
          if (
            checkAuthPromise &&
            checkAuthOperationEpoch !== null &&
            checkAuthOperationEpoch === authOperationEpoch
          ) {
            return checkAuthPromise;
          }

          const operationEpoch = beginAuthOperation();
          checkAuthOperationEpoch = operationEpoch;
          const cachedUser = get().user;
          if (!options.background) set({ isLoading: true });

          const promise = (async () => {
            try {
              const [wasLoggedOut, tokens] = await Promise.all([
                authSessionStorage.wasLoggedOut(),
                tokenStorage.getTokens(),
              ]);
              const accessToken = tokens?.accessToken ?? null;
              const refreshToken = tokens?.refreshToken ?? null;

              if (!isCurrentOperation(operationEpoch)) return;

              if (wasLoggedOut || !refreshToken) {
                apiClient.invalidateSession();
                tokenStorage.invalidate();
                disableSubmissionPersistence();
                await Promise.allSettled([
                  tokenStorage.clearTokens(),
                  clearAllSubmissionData(),
                  clearQueryCache(),
                ]);
                if (isCurrentOperation(operationEpoch)) setUnauthenticated(true);
                return;
              }

              logger.dev("checkAuth: validating stored session", {
                hasAccessToken: Boolean(accessToken),
                hasRefreshToken: true,
              });

              const response = await apiClient.get<UserMeResponse>("/user/me");
              if (!isCurrentOperation(operationEpoch)) return;

              const accessValidation = validateUserAccess(response.user);
              if (!accessValidation.hasAccess) {
                await get().logout();
                return;
              }

              await authSessionStorage.markActive();
              if (!isCurrentOperation(operationEpoch)) return;

              enableSubmissionPersistence();
              set({
                user: mergeServerUser(response.user, cachedUser),
                isAuthenticated: true,
                isLoading: false,
                isInitialized: true,
              });
            } catch (error) {
              if (!isCurrentOperation(operationEpoch)) return;

              if (
                error instanceof ApiError && error.isAuthenticationError
              ) {
                await get().logout();
                return;
              }

              if (error instanceof ApiError && error.isTransient) {
                logger.info(
                  "checkAuth: transient validation failure, preserving cached session",
                );
                if (cachedUser) enableSubmissionPersistence();
                set({
                  user: cachedUser,
                  isAuthenticated: Boolean(cachedUser),
                  isLoading: false,
                  isInitialized: true,
                });
                return;
              }

              if (isAbortError(error)) return;
              logger.error("checkAuth: non-recoverable validation failure");
              await get().logout();
            } finally {
              if (isCurrentOperation(operationEpoch)) {
                set({ isLoading: false, isInitialized: true });
              }
            }
          })();

          checkAuthPromise = promise;
          try {
            await promise;
          } finally {
            if (checkAuthPromise === promise) {
              checkAuthPromise = null;
              checkAuthOperationEpoch = null;
            }
          }
        },
      };
    },
    {
      name: "auth-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ user: state.user }),
      skipHydration: true,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<AuthState>),
        isAuthenticated: false,
        isLoading: false,
        isInitialized: false,
      }),
    },
  ),
);
