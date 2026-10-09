import { Redirect } from "expo-router";

import { LoadingSpinner } from "../components/ui";
import { useAuthStore } from "../store";

import { landingHref } from "@/features/access/app-surfaces";

/**
 * Where the app opens: cold start, and after login (the root guard flips to
 * the protected group and lands here). A driver of a company without Gestão
 * de Frota opens on Entregas; everyone else on "Início", which explains itself
 * when nothing there is theirs.
 */
const Index = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  const isInitialized = useAuthStore((state) => state.isInitialized);
  const user = useAuthStore((state) => state.user);

  if (!isInitialized || isLoading) {
    return <LoadingSpinner text="Carregando..." className="bg-background" />;
  }

  return <Redirect href={isAuthenticated ? landingHref(user) : "/login"} />;
};

export default Index;
