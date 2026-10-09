import AsyncStorage from "@react-native-async-storage/async-storage";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { clearQueryCache } from "../providers/query-provider";
import { cancelChatUnreadRefresh } from "../features/chat/unread-refresh";
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

import { signOutRemotely } from "../features/auth/remote-logout";
import { clearOnTheWayStore } from "../features/deliveries/on-the-way-store";
import { clearProofFeedbackStore } from "../features/notifications/proof-feedback-store";
import { flushBeforeSignOut } from "../features/tracking/reporter";
import { isUpgradeRequired } from "../features/app-update/upgrade-rules";
import { ApiError, apiClient } from "../utils/api";
import {
  forgetTwoFactorChallenge,
  rememberTwoFactorChallenge,
  twoFactorChallengeFor,
} from "../features/auth/two-factor-challenge";
import { isTokenExpired } from "../utils/jwt";
import { logger } from "../utils/logger";

import { validateUserAccess } from "../utils/permissions";
import {
  SIGN_IN_REFUSED_MESSAGE,
  accessMessage,
} from "../features/access/access-messages";
import { disconnectSocket } from "../utils/socket";

import {
  modulesAfterServerRefresh,
  withSessionModules,
} from "../features/access/module-rules";
import { observeEnabledModules } from "../features/access/module-observations";
import { stampAiFlag } from "../features/ai-precheck/precheck-gate";

import { authSessionStorage, tokenStorage } from "../utils/storage";
import {
  getRegisteredPushToken,
  setRegisteredPushToken,
} from "../utils/push-token";

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

const mergeServerUser = (received: User, cachedUser: User | null): User => {
  // Stamped on arrival: the pre-check flag is trusted for the offline
  // window only (decision 14.2).
  const serverUser = stampAiFlag(received);

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
      // The selected company's plan, not the "everything" /user/me gives a
      // MASTER (decision 4.3).
      enabledModules: modulesAfterServerRefresh(serverUser, cachedUser),
    };
  }

  return serverUser;
};

/**
 * Tells the offline queue what `/user/me` just said about the company's plan,
 * so submissions parked while a module was off go out once it is back
 * (MOB-03). A MASTER's `/user/me` is not a company's plan; theirs arrives
 * through `applyBusinessModules`.
 */
const observeServerModules = (user: User): void => {
  if (user.role === "MASTER") return;

  void observeEnabledModules({
    businessId: user.businessId,
    enabledModules: user.enabledModules ?? [],
  }).catch(() => undefined);
};

const getAccessErrorMessage = (reason?: string): string =>
  accessMessage(reason, SIGN_IN_REFUSED_MESSAGE);

const getAuthenticationErrorMessage = (
  error: unknown,
  fallback: string,
): string => {
  if (isAbortError(error)) return "Operação cancelada.";
  if (error instanceof ApiError) {
    if (error.category === "NETWORK") {
      return "Erro de rede. Verifique sua conexão.";
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
          await tokenStorage.setTokens(accessToken, refreshToken, storageEpoch);
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

          enableSubmissionPersistence(user.id);
          set({
            user: stampAiFlag(user),
            isAuthenticated: true,
            isLoading: false,
            isInitialized: true,
          });
          observeServerModules(user);
          return { success: true };
        } catch (error) {
          if (tokensWereStaged && isCurrentOperation(operationEpoch)) {
            await rejectStagedSession(operationEpoch);
          }
          return {
            success: false,
            error: getAuthenticationErrorMessage(
              error,
              "Não foi possível concluir a autenticação.",
            ),
          };
        }
      };

      return {
        user: null,
        isAuthenticated: false,
        isLoading: false,
        isInitialized: false,

        // A local change of company (MASTER) drops the previous company's
        // plan until the new one is fetched — see withSessionModules.
        setUser: (user: User) =>
          set((state) => ({ user: withSessionModules(user, state.user) })),
        setServerUser: (user: User) => {
          set((state) => ({ user: mergeServerUser(user, state.user) }));
          observeServerModules(user);
        },

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
              return { success: false, error: "Operação cancelada." };
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
              // Proof of the password for the code step (in memory only).
              rememberTwoFactorChallenge(
                email,
                response.twoFactorChallenge,
              );

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
                // The challenge goes only when the API sent one; otherwise
                // this is the body older builds send.
                { email, code, ...twoFactorChallengeFor(email) },
                false,
              );

            // The code is spent, and the challenge with it.
            forgetTwoFactorChallenge();

            if (!isCurrentOperation(operationEpoch)) {
              return { success: false, error: "Operação cancelada." };
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
                "Código inválido ou expirado.",
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
              // The API resends only to whoever just proved the password.
              { email, ...twoFactorChallengeFor(email) },
              false,
            );
            return { success: true };
          } catch (error) {
            return {
              success: false,
              error: getAuthenticationErrorMessage(
                error,
                "Erro ao reenviar código.",
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

          forgetTwoFactorChallenge();

          // Capture the tokens before local cleanup (the storage queue reads
          // them ahead of the clear below). These requests do not take part
          // in authenticated-request cancellation, so they still reach the
          // server after the local session epoch is invalidated.
          //
          // Unregister the push device FIRST, then end the session — see
          // features/auth/remote-logout. Sent side by side, the logout often
          // won and the unregister was refused. If none of this reaches the
          // server (killed app, no network), the server drops the session's
          // devices once the session expires.
          const registeredPushToken = getRegisteredPushToken();
          setRegisteredPushToken(null);

          const signingOutUserId = get().user?.id ?? null;

          const remoteLogoutPromise = tokenStorage
            .getTokens()
            .then(async (tokens) => {
              // The route's last stretch goes out while the session still
              // exists — before the server logout ends it (MOB-24). Bounded
              // and never throws; see flushBeforeSignOut.
              await flushBeforeSignOut({
                userId: signingOutUserId,
                accessToken: tokens?.accessToken ?? null,
              });

              return signOutRemotely(
                {
                  accessToken: tokens?.accessToken ?? null,
                  refreshToken: tokens?.refreshToken ?? null,
                  pushToken: registeredPushToken,
                },
                {
                  send: (method, path, accessToken, body) =>
                    apiClient.request(path, {
                      method,
                      body,
                      requiresAuth: false,
                      headers: { Authorization: `Bearer ${accessToken}` },
                      timeoutMs: 5_000,
                    }),
                  renew: async (refreshToken) => {
                    const renewed = await apiClient.request<{
                      token?: string;
                    }>("/user/refresh-token", {
                      method: "POST",
                      body: { token: refreshToken },
                      requiresAuth: false,
                      timeoutMs: 5_000,
                    });

                    return renewed?.token ?? null;
                  },
                  isExpired: (accessToken) => isTokenExpired(accessToken),
                },
              );
            });

          const operationEpoch = beginAuthOperation();
          logoutOperationEpoch = operationEpoch;

          apiClient.invalidateSession();
          tokenStorage.invalidate();

          const markerEpoch = authSessionStorage.invalidate();
          disableSubmissionPersistence();

          disconnectSocket(true);
          setUnauthenticated(true);

          // A badge refetch still inside its coalescing window belongs to
          // the session that is ending (MOB-09): dropped with the cache
          // below instead of firing on whoever signs in next.
          cancelChatUnreadRefresh();

          const promise = (async () => {
            const results = await Promise.allSettled([
              remoteLogoutPromise,
              authSessionStorage.markLoggedOut(markerEpoch),
              tokenStorage.clearTokens(),
              authSessionStorage.clearPersistedAuth(),
              clearAllSubmissionData(),
              clearQueryCache(),
              // The driver's own records (decision 2.6); the pause store is
              // kept on purpose (see pause-store).
              clearProofFeedbackStore(),
              clearOnTheWayStore(),
            ]);
            // The remote calls (push unregister, server logout) are
            // deliberately best-effort. Local credential cleanup failures
            // are the ones that require diagnostics.
            const failures = results
              .slice(1)
              .filter((result) => result.status === "rejected");
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

                if (isCurrentOperation(operationEpoch))
                  setUnauthenticated(true);

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

              enableSubmissionPersistence(response.user.id);
              set({
                user: mergeServerUser(response.user, cachedUser),
                isAuthenticated: true,
                isLoading: false,
                isInitialized: true,
              });
              observeServerModules(response.user);
            } catch (error) {
              if (!isCurrentOperation(operationEpoch)) return;

              if (error instanceof ApiError && error.isAuthenticationError) {
                await get().logout();
                return;
              }

              // A 426 CLIENT_UPGRADE_REQUIRED is about this BUILD, not the
              // session (GAP5-2): logging out here cost the driver the
              // session, the drafts and a 2FA sign-in after the update. The
              // cached session is kept, as when the API is unreachable, and
              // the update screen (raised by apiClient) takes over.
              if (
                error instanceof ApiError &&
                (error.isTransient ||
                  isUpgradeRequired(error.status, error.code))
              ) {
                logger.info(
                  "checkAuth: transient validation failure, preserving cached session",
                );

                if (cachedUser) enableSubmissionPersistence(cachedUser.id);
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

const sameModules = (
  current: readonly string[] | undefined,
  next: readonly string[],
): boolean =>
  Array.isArray(current) &&
  current.length === next.length &&
  next.every((module) => current.includes(module));

/**
 * A MASTER's view of the company they picked: its plan, from the plan
 * endpoint (`/user/me` answers a MASTER with every module).
 *
 * Applied only while that company is still the one selected — an answer that
 * lands after the MASTER switched again belongs to the previous company.
 * `observedAt` is when the server answered, so two screens reading the same
 * cached answer count as one word for the offline queue, not two.
 */
export const applyBusinessModules = (
  businessId: string,
  enabledModules: string[],
  observedAt: number,
): void => {
  const { user } = useAuthStore.getState();

  if (!user || user.role !== "MASTER" || user.businessId !== businessId) return;

  if (!sameModules(user.enabledModules, enabledModules)) {
    useAuthStore.setState({ user: { ...user, enabledModules } });
  }

  void observeEnabledModules({ businessId, enabledModules, observedAt }).catch(
    () => undefined,
  );
};
