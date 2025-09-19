import { useEffect } from "react";
import { Redirect } from "expo-router";

import { useAuthStore } from "../store";
import { LoadingSpinner } from "../components/ui";

const Index = () => {
  const { isAuthenticated, isLoading, isInitialized, checkAuth } =
    useAuthStore();

  useEffect(() => {
    if (!isInitialized) {
      checkAuth();
    }
  }, [isInitialized, checkAuth]);

  // Show loading while initializing auth
  if (!isInitialized || isLoading) {
    return <LoadingSpinner text="Carregando..." className="bg-white" />;
  }

  // Redirect based on auth status
  if (isAuthenticated) {
    return <Redirect href="/vehicles" />;
  }

  return <Redirect href="/login" />;
};

export default Index;
