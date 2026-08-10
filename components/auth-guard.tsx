import type { PropsWithChildren } from "react";
import { Redirect, useSegments } from "expo-router";

import { useAuthStore } from "../store";
import { LoadingSpinner } from "./ui";

/**
 * Compatibility guard for callers outside the root navigator. The root Stack
 * is the source of truth and uses Stack.Protected declaratively.
 */
export const AuthGuard = ({ children }: PropsWithChildren) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const segments = useSegments();

  if (!isInitialized || isLoading) {
    return <LoadingSpinner text="Carregando..." className="bg-white" />;
  }

  const inAuthGroup = segments[0] === "(auth)";
  if (!isAuthenticated && !inAuthGroup) return <Redirect href="/login" />;
  if (isAuthenticated && inAuthGroup) return <Redirect href="/vehicles" />;
  return <>{children}</>;
};
