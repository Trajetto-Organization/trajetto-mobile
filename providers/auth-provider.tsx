import type { PropsWithChildren } from "react";

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuthStore } from "../store";
import { apiClient } from "../utils/api";

import { logger } from "../utils/logger";

let initializationPromise: Promise<void> | null = null;

const initializeAuthentication = (): Promise<void> => {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      await useAuthStore.persist.rehydrate();
    } catch {
      logger.error("AuthProvider: persisted auth hydration failed");
    }

    await useAuthStore.getState().checkAuth();
  })();

  return initializationPromise;
};

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const lastResumeCheckAt = useRef(0);

  useEffect(() => {
    apiClient.setLogoutCallback(() => useAuthStore.getState().logout());
    void initializeAuthentication();

    return () => apiClient.setLogoutCallback(null);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const becameActive =
        appState.current !== "active" && nextState === "active";
      appState.current = nextState;

      if (!becameActive) return;
      const now = Date.now();

      if (now - lastResumeCheckAt.current < 3_000) return;
      lastResumeCheckAt.current = now;

      const authState = useAuthStore.getState();
      if (authState.isInitialized) {
        void authState.checkAuth({ background: true });
      }
    });

    return () => subscription.remove();
  }, []);

  return <>{children}</>;
};
