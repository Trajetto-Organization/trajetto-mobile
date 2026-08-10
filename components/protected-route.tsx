import type { PropsWithChildren, ReactNode } from "react";

import { Redirect } from "expo-router";
import { Text, View } from "react-native";

import { useAuthStore } from "../store";
import { validateUserAccess } from "../utils/permissions";

import { Button, LoadingSpinner } from "./ui";

interface ProtectedRouteProps extends PropsWithChildren {
  fallback?: ReactNode;
}

export const ProtectedRoute = ({ children, fallback }: ProtectedRouteProps) => {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  const isInitialized = useAuthStore((state) => state.isInitialized);

  if (!isInitialized || isLoading) {
    return (
      <LoadingSpinner text="Verificando permissoes..." className="bg-white" />
    );
  }

  if (!isAuthenticated || !user) {
    return fallback ?? <Redirect href="/login" />;
  }

  const accessValidation = validateUserAccess(user);
  if (!accessValidation.hasAccess) {
    let title = "Acesso negado";
    let message = "Voce nao tem permissao para acessar esta funcionalidade.";

    switch (accessValidation.reason) {
      case "access_revoked":
        title = "Acesso revogado";
        message =
          "Seu acesso foi revogado. Entre em contato com o administrador.";
        break;
      case "driver_inactive":
        title = "Motorista inativo";
        message =
          "Seu cadastro como motorista esta inativo. Entre em contato com o administrador.";
        break;
      case "no_permissions":
        title = "Sem permissoes";
        message =
          "Voce nao possui permissoes configuradas. Entre em contato com o administrador.";
        break;
      case "no_vehicle_permission":
        title = "Permissao insuficiente";
        message =
          "Voce nao possui permissao para visualizar os veiculos. Entre em contato com o administrador.";
        break;
    }

    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <View className="mb-6 h-20 w-20 items-center justify-center rounded-full bg-danger-100">
          <Text className="text-2xl text-danger-600">!</Text>
        </View>
        <Text className="mb-4 text-center text-xl font-bold text-gray-900">
          {title}
        </Text>
        <Text className="mb-8 text-center text-gray-600">{message}</Text>
        <Button onPress={() => void logout()} variant="danger">
          Sair da conta
        </Button>
      </View>
    );
  }

  return <>{children}</>;
};
