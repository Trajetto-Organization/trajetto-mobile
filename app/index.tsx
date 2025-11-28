import { Redirect } from "expo-router";

import { useAuthStore } from "../store";
import { LoadingSpinner } from "../components/ui";

const Index = () => {
  const { isAuthenticated, isLoading, isInitialized } = useAuthStore();

  // ✅ DON'T call checkAuth here - AuthProvider already handles it!
  // Calling it here would create a race condition with duplicate requests

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
