import type { PropsWithChildren } from "react";

import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import Toast from "react-native-toast-message";

import { useAuthStore } from "../store/auth-store";
import type { UserMeResponse } from "../types";

import { ApiError, apiClient } from "../utils/api";
import { validateUserAccess } from "../utils/permissions";

import {
  backgroundSocket,
  disconnectSocket,
  foregroundSocket,
  initializeSocket,
} from "../utils/socket";
import { securityActionEndsSession } from "../utils/socket-auth-rules";

import {
  bindAccessEvents,
  rereadWithTrailing,
} from "../features/access/access-events";
import {
  SESSION_ENDED_MESSAGE,
  accessMessage,
  refusalReason,
} from "../features/access/access-messages";

const SECURITY_EVENT = "securityAction";

export const SocketProvider = ({ children }: PropsWithChildren) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);

  const setServerUser = useAuthStore((state) => state.setServerUser);

  const isHandlingLogout = useRef(false);

  const appState = useRef<AppStateStatus>(AppState.currentState);

  const handleForceLogout = useCallback(
    async (reason: string) => {
      if (isHandlingLogout.current) return;
      isHandlingLogout.current = true;

      Toast.show({
        type: "error",
        text1: "Acesso encerrado",
        text2: accessMessage(reason, SESSION_ENDED_MESSAGE),
        position: "top",
        visibilityTime: 6_000,
      });

      await logout();
    },
    [logout],
  );

  const readAccess = useCallback(async () => {
    // A read queued behind one that ended the session has nothing to read.
    if (isHandlingLogout.current) return;

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
      // /user/me refuses only for the session's eligibility; the code says
      // which (an inactive company is not a deleted account, decision 4.1).
      if (error instanceof ApiError && error.status === 403) {
        await handleForceLogout(refusalReason(error.code));
      }
      // Offline/5xx must not revoke a valid local session. A 401 is already
      // handled centrally by ApiClient's logout callback.
    }
  }, [handleForceLogout, setServerUser]);

  // The latest readAccess, for a runner created once per mount.
  const latestReadAccess = useRef(readAccess);
  useEffect(() => {
    latestReadAccess.current = readAccess;
  }, [readAccess]);

  // One /user/me at a time, plus one more when a change arrived during it:
  // that read may have left before the change reached the server (MOB-11).
  const permissionsCheck = useRef<(() => Promise<void>) | null>(null);
  if (!permissionsCheck.current) {
    permissionsCheck.current = rereadWithTrailing(() =>
      latestReadAccess.current(),
    );
  }

  const handlePermissionsChanged = useCallback(
    () => permissionsCheck.current?.() ?? Promise.resolve(),
    [],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket(false);
      return;
    }

    isHandlingLogout.current = false;

    let disposed = false;
    let boundSocket: Awaited<ReturnType<typeof initializeSocket>> | null = null;
    let unbindAccessEvents: (() => void) | null = null;

    const handleSecurityAction = async (event?: { reason?: string }) => {
      if (disposed) return;
      const reason = event?.reason ?? "access_denied";

      // Authorization-only reasons (the server keeps the socket for them):
      // re-read /user/me instead of logging out.
      if (!securityActionEndsSession(reason)) {
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

        // A module switched on or off: the same /user/me re-read as a
        // permission change, so tabs, screens and parked submissions follow
        // at once instead of on the next foreground (MOB-11).
        unbindAccessEvents?.();
        unbindAccessEvents = bindAccessEvents(socket, handlePermissionsChanged);

        if (!socket.connected && !socket.active) socket.connect();
      })
      .catch(() => {
        // AppState and Socket.IO reconnection will retry without logging out on
        // ordinary network failures.
      });

    return () => {
      disposed = true;
      boundSocket?.off(SECURITY_EVENT, handleSecurityAction);
      unbindAccessEvents?.();
    };
  }, [isAuthenticated, handleForceLogout, handlePermissionsChanged]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const becameActive =
        appState.current !== "active" && nextState === "active";
      appState.current = nextState;

      if (!useAuthStore.getState().isAuthenticated) return;

      // Paused only after a grace: a glance at Waze and back keeps the
      // socket, and with it every event sent meanwhile (MOB-20).
      if (nextState !== "active") {
        backgroundSocket();
        return;
      }

      if (!becameActive) return;

      void foregroundSocket().catch(() => {
        // Nothing to add here. A failed reconnection means the socket did not
        // carry the absence, so AuthProvider re-checks /user/me; when it did
        // carry it, any securityAction already arrived live, and the
        // server's periodic sweep still ends (announcing why) a socket whose
        // session died if that frame was lost.
      });
    });

    return () => subscription.remove();
  }, []);

  return <>{children}</>;
};
