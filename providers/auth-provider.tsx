import React, { useEffect, useRef } from "react";
import { useAuthStore } from "../store";

import { logger } from "../utils/logger";

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { checkAuth, isInitialized, setInitialized } = useAuthStore();

  const isCheckingAuth = useRef(false); // 🔒 Prevent duplicate calls
  const hasInitialized = useRef(false); // 🔒 Track if we've already initialized

  useEffect(() => {
    // Initialize auth state when app starts (only once)
    if (!isInitialized && !isCheckingAuth.current && !hasInitialized.current) {
      isCheckingAuth.current = true;
      hasInitialized.current = true;

      logger.dev("🔐 AuthProvider: Initializing auth state...");
      checkAuth().finally(() => {
        logger.dev("🔐 AuthProvider: Auth state initialized");
        setInitialized(true);
        isCheckingAuth.current = false;
      });
    }
  }, [isInitialized, checkAuth, setInitialized]);

  return <>{children}</>;
};
