import type { PropsWithChildren } from "react";
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import Toast from "react-native-toast-message";

import { useAuthStore } from "../store/auth-store";
import type { UserMeResponse } from "../types";
import { ApiError, apiClient } from "../utils/api";
import { validateUserAccess } from "../utils/permissions";
import {
  disconnectSocket,
  initializeSocket,
  pauseSocket,
  reconnectSocket,
  updateSocketAuthToken,
} from "../utils/socket";

const SECURITY_EVENT = "securityAction";

const REVOKE_MESSAGES: Record<string, string> = {
  access_revoked:
    "Seu acesso foi revogado. Entre em contato com o administrador.",
  access_denied: "Sua conta foi excluida ou nao esta autorizada.",
  driver_inactive:
    "Seu cadastro como motorista esta inativo. Entre em contato com o administrador.",
  no_permissions: "Seu usuario nao possui permissoes configuradas.",
  no_vehicle_permission:
    "Voce nao possui permissao para visualizar veiculos.",
  permissions_changed:
    "Suas permissoes foram atualizadas. Faca login novamente.",
};

export const SocketProvider = ({ children }: PropsWithChildren) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);
  const setServerUser = useAuthStore((state) => state.setServerUser);
  const isHandlingLogout = useRef(false);
  const permissionsCheck = useRef<Promise<void> | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const handleForceLogout = useCallback(
    async (reason: string) => {
      if (isHandlingLogout.current) return;
      isHandlingLogout.current = true;

      Toast.show({
        type: "error",
        text1: "Acesso encerrado",
        text2:
          REVOKE_MESSAGES[reason] ??
          "Sua sessao foi encerrada. Faca login novamente.",
        position: "top",
        visibilityTime: 6_000,
      });

      await logout();
    },
    [logout],
  );

  const handlePermissionsChanged = useCallback(async () => {
    if (permissionsCheck.current) return permissionsCheck.current;

    const promise = (async () => {
      try {
        const response = await apiClient.get<UserMeResponse>("/user/me");
        const accessValidation = validateUserAccess(response.user);

        if (!accessValidation.hasAccess) {
          await handleForceLogout(
            accessValidation.reason ?? "permissions_changed",
          );
          return;
        }

        setServerUser(response.user);
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          await handleForceLogout("access_denied");
        }
        // Offline/5xx must not revoke a valid local session. A 401 is already
        // handled centrally by ApiClient's logout callback.
      }
    })();

    permissionsCheck.current = promise;
    try {
      await promise;
    } finally {
      if (permissionsCheck.current === promise) {
        permissionsCheck.current = null;
      }
    }
  }, [handleForceLogout, setServerUser]);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket(false);
      return;
    }

    isHandlingLogout.current = false;
    let disposed = false;
    let boundSocket: Awaited<ReturnType<typeof initializeSocket>> | null = null;

    const handleSecurityAction = async (event?: { reason?: string }) => {
      if (disposed) return;
      const reason = event?.reason ?? "access_denied";

      if (reason === "permissions_changed") {
        await handlePermissionsChanged();
        return;
      }

      await handleForceLogout(reason);
    };

    void initializeSocket()
      .then((socket) => {
        if (disposed) return;
        boundSocket = socket;
        socket.off(SECURITY_EVENT, handleSecurityAction);
        socket.on(SECURITY_EVENT, handleSecurityAction);
        if (!socket.connected && !socket.active) socket.connect();
      })
      .catch(() => {
        // AppState and Socket.IO reconnection will retry without logging out on
        // ordinary network failures.
      });

    return () => {
      disposed = true;
      boundSocket?.off(SECURITY_EVENT, handleSecurityAction);
    };
  }, [isAuthenticated, handleForceLogout, handlePermissionsChanged]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const becameActive =
        appState.current !== "active" && nextState === "active";
      appState.current = nextState;
      if (!useAuthStore.getState().isAuthenticated) return;

      if (nextState !== "active") {
        pauseSocket();
        return;
      }
      if (!becameActive) return;

      void updateSocketAuthToken()
        .then(() => reconnectSocket())
        .catch(() => {
          // AuthProvider performs the authoritative /user/me revalidation.
        });
    });

    return () => subscription.remove();
  }, []);

  return <>{children}</>;
};
