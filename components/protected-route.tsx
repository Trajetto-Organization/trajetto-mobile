import { View, Text } from "react-native";
import { useRouter } from "expo-router";

import { useAuthStore } from "../store";
import { validateUserAccess } from "../utils/permissions";

import { LoadingSpinner, Button } from "./ui";

interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  fallback,
}) => {
  const router = useRouter();
  const { user, logout, isLoading } = useAuthStore();

  const handleLogin = () => {
    router.replace("/login");
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (isLoading) {
    return (
      <LoadingSpinner text="Verificando permissões..." className="bg-white" />
    );
  }

  if (!user) {
    return (
      fallback || (
        <View
          className="flex-1 justify-center 
          items-center bg-white px-6"
        >
          <Text
            className="text-xl font-bold 
            text-gray-900 mb-4 text-center"
          >
            Acesso não autorizado
          </Text>
          <Text className="text-gray-600 text-center mb-8">
            Você precisa estar logado para acessar esta tela.
          </Text>
          <Button onPress={handleLogin} variant="primary">
            Fazer login
          </Button>
        </View>
      )
    );
  }

  const accessValidation = validateUserAccess(user);

  if (!accessValidation.hasAccess) {
    let title = "Acesso negado";
    let message = "Você não tem permissão para acessar esta funcionalidade.";

    switch (accessValidation.reason) {
      case "access_revoked":
        title = "Acesso revogado";
        message =
          "Seu acesso foi revogado. Entre em contato com o administrador.";
        break;
      case "no_permissions":
        title = "Sem permissões";
        message =
          "Você não possui permissões configuradas. Entre em contato com o administrador.";
        break;
      case "no_vehicle_permission":
        title = "Permissão insuficiente";
        message =
          "Você não possui permissão para visualizar veículos. Entre em contato com o administrador.";
        break;
    }

    return (
      <View
        className="flex-1 justify-center 
        items-center bg-white px-6"
      >
        <View
          className="w-20 h-20 bg-danger-100 
          rounded-full items-center justify-center mb-6"
        >
          <Text className="text-danger-600 text-2xl">⚠️</Text>
        </View>

        <Text
          className="text-xl font-bold 
          text-gray-900 mb-4 text-center"
        >
          {title}
        </Text>

        <Text
          className="text-gray-600 
          text-center mb-8"
        >
          {message}
        </Text>

        <Button onPress={handleLogout} variant="danger">
          Sair da conta
        </Button>
      </View>
    );
  }

  return <>{children}</>;
};
