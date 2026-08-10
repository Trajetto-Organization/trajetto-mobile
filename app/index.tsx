import { Redirect } from "expo-router";

import { LoadingSpinner } from "../components/ui";
import { useAuthStore } from "../store";

const Index = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const isInitialized = useAuthStore((state) => state.isInitialized);

  if (!isInitialized || isLoading) {
    return <LoadingSpinner text="Carregando..." className="bg-white" />;
  }

  return <Redirect href={isAuthenticated ? "/vehicles" : "/login"} />;
};

export default Index;
