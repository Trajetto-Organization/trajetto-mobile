import React, { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";

import { useAuthStore } from "../store";
import { LoadingSpinner } from "./ui";

interface AuthGuardProps {
  children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, isLoading, isInitialized } = useAuthStore();

  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!isInitialized || isLoading) return;
    const inAuthGroup = segments[0] === "(auth)";

    if (!isAuthenticated && !inAuthGroup) {
      // User is not authenticated and trying to access protected route
      router.replace("/login");
    } else if (isAuthenticated && inAuthGroup) {
      // User is authenticated and trying to access auth routes
      router.replace("/vehicles");
    }
  }, [isAuthenticated, isInitialized, isLoading, segments]);

  // Show loading while initializing
  if (!isInitialized || isLoading) {
    return <LoadingSpinner text="Carregando..." className="bg-white" />;
  }

  return <>{children}</>;
};
