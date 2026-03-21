import React, { useEffect, useRef } from "react";

import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import { useAuthStore } from "../store/auth-store";
import { initializeSocket, disconnectSocket, getSocket } from "../utils/socket";

import { apiClient } from "../utils/api";
import { validateUserAccess } from "../utils/permissions";

import type { UserMeResponse } from "../types";

// The backend emits "securityAction" with a reason field:
// - "access_revoked"       → sent directly to the specific user
// - "permissions_changed"  → broadcast to the whole business room
const SECURITY_EVENT = "securityAction";

// Maps reason → human-readable message (mirrors the messages in auth-store)
const REVOKE_MESSAGES: Record<string, string> = {
  access_revoked:
    "Seu acesso foi revogado! Para acessar a plataforma novamente, por favor contate o administrador.",
  access_denied:
    "Sua conta foi excluída ou não está autorizada. Por favor, entre em contato com o administrador.",
  driver_inactive:
    "Seu cadastro como motorista está inativo! Para acessar a plataforma novamente, por favor contate o administrador.",
  no_permissions:
    "Usuário sem perfil de acesso ou permissões configuradas! Por favor, contate o administrador.",
  no_vehicle_permission:
    "Você não possui permissão para visualizar veículos! Por favor, contate o administrador.",
  permissions_changed:
    "Suas permissões de acesso foram atualizadas. Por favor, faça login novamente para continuar.",
};

interface SocketProviderProps {
  children: React.ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const { isAuthenticated, logout, setUser } = useAuthStore();
  const router = useRouter();

  // Guard to prevent double-execution when multiple events arrive at once
  const isHandlingLogout = useRef(false);

  // ── Force logout ─────────────────────────────────────────────────────────
  // Called when the backend revokes access directly (reason = "access_revoked")
  // or when a permissions re-check confirms this user has lost access.
  const handleForceLogout = async (reason: string) => {
    if (isHandlingLogout.current) return;
    isHandlingLogout.current = true;

    const message =
      REVOKE_MESSAGES[reason] ??
      "Sua sessão foi encerrada. Faça login novamente.";

    // Show the toast BEFORE navigating so the user sees it
    Toast.show({
      type: "error",
      text1: "Acesso encerrado",
      text2: message,
      position: "top",
      visibilityTime: 6000,
    });

    // Disconnect socket first (emits client_logout to server)
    disconnectSocket();

    // Clear all auth state
    await logout();

    // Redirect to login
    router.replace("/(auth)/login");

    // Reset guard after navigation settles
    setTimeout(() => {
      isHandlingLogout.current = false;
    }, 3000);
  };

  // ── Permissions changed ───────────────────────────────────────────────────
  // "permissions_changed" is sent to the ENTIRE business room, so it fires
  // for every connected user whenever anyone's permissions change.
  // We re-fetch /user/me and re-validate to check if THIS user was affected.
  const handlePermissionsChanged = async () => {
    try {
      const response = await apiClient.get<UserMeResponse>("/user/me");
      const user = response.user;

      const accessValidation = validateUserAccess(user);

      if (!accessValidation.hasAccess) {
        // This user lost access — force logout with the specific reason
        await handleForceLogout(
          accessValidation.reason ?? "permissions_changed",
        );
      } else {
        // Access still valid — silently update user data in the store
        // (they may have received new/updated permissions)
        setUser(user);
      }
    } catch {
      // Network error: do not force logout — the user may just be offline.
      // The API token refresh / 401 handler will deal with truly expired sessions.
    }
  };

  // ── Socket lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    // Disconnect if user logged out
    if (!isAuthenticated) {
      disconnectSocket();
      return;
    }

    let isMounted = true;

    const connectAndListen = async () => {
      try {
        const socket = await initializeSocket();
        if (!isMounted) return;

        socket.on(SECURITY_EVENT, async (event: { reason: string }) => {
          if (!isMounted) return;

          if (event.reason === "access_revoked") {
            // Direct revocation → immediate logout
            await handleForceLogout("access_revoked");
            return;
          }

          if (event.reason === "permissions_changed") {
            // Business-wide event → re-validate this user specifically
            await handlePermissionsChanged();
            return;
          }

          // Any other security reason → force logout as a safe default
          await handleForceLogout(event.reason);
        });
      } catch {
        // Socket connection failed — auth continues to work normally via HTTP.
        // The user simply won't receive real-time revocation events until
        // the next app restart or reconnect attempt.
      }
    };

    connectAndListen();

    return () => {
      isMounted = false;

      // Remove only the listeners we added; do NOT disconnect the socket here
      // (it may still be used for other events like push notifications)
      const socket = getSocket();
      if (socket) {
        socket.off(SECURITY_EVENT);
      }
    };
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>;
};
