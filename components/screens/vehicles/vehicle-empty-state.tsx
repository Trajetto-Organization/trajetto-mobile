import { View, Text, TouchableOpacity } from "react-native";
import { Button } from "../../ui";

interface VehicleEmptyStateProps {
  isSearchResult?: boolean;
  searchQuery?: string;
  refreshing: boolean;
  onClearSearch?: () => void;
  onRefresh: () => void;
  onOpenWebPlatform?: () => void;
  isDriverWithoutVehicles?: boolean;
}

export const VehicleEmptyState: React.FC<VehicleEmptyStateProps> = ({
  isSearchResult = false,
  searchQuery = "",
  refreshing,
  onClearSearch,
  onRefresh,
  onOpenWebPlatform,
  isDriverWithoutVehicles = false,
}) => {
  // Special message for drivers without vehicles
  if (isDriverWithoutVehicles && !isSearchResult) {
    return (
      <View className="flex-1 mt-10 items-center px-8">
        {/* Animated illustration */}
        <View className="relative mb-8">
          <View
            className="w-32 h-32 justify-center
            rounded-3xl items-center"
          >
            <Text className="text-6xl">🚗</Text>
          </View>
          {/* Floating elements */}
          <View
            className="absolute -top-2 -right-2 w-10 h-10
            bg-blue-500 rounded-full items-center justify-center"
          >
            <Text className="text-white text-xs font-bold">+</Text>
          </View>
        </View>

        <Text className="text-2xl font-bold text-gray-900 mb-3 text-center">
          Aguardando veículos 🔑
        </Text>
        <Text
          className="text-gray-600 text-center
          mb-8 text-base leading-6 max-w-sm"
        >
          Ainda não há veículos associados ao seu perfil de motorista. Entre em
          contato com o administrador para que veículos sejam vinculados a você.
        </Text>

        {/* Action buttons */}
        <View className="w-full max-w-xs">
          <Button
            onPress={onRefresh}
            loading={refreshing}
            disabled={refreshing}
            className="mb-3"
          >
            {refreshing ? "Atualizando..." : "🔄 Atualizar lista"}
          </Button>
        </View>

        {/* Decorative dots */}
        <View className="flex-row items-center mt-8 space-x-2">
          <View className="w-2 h-2 bg-blue-200 rounded-full" />
          <View className="w-3 h-3 bg-blue-400 rounded-full" />
          <View className="w-2 h-2 bg-blue-200 rounded-full" />
        </View>
      </View>
    );
  }

  if (isSearchResult) {
    return (
      <View className="flex-1 mt-16 items-center px-8">
        <Text
          className="text-2xl font-bold
          text-gray-900 mb-3 text-center"
        >
          Nenhum resultado encontrado
        </Text>
        <Text
          className="text-gray-600 text-center
          mb-8 text-base leading-6 max-w-sm"
          numberOfLines={3}
          ellipsizeMode="tail"
        >
          Não encontramos veículos com{" "}
          <Text className="font-semibold">
            &quot;
            {searchQuery.length > 15
              ? searchQuery.substring(0, 15) + "..."
              : searchQuery}
            &quot;
          </Text>
          . Tente buscar por placa, modelo ou marca.
        </Text>

        {/* Action buttons */}
        <View className="w-full max-w-xs">
          {onClearSearch && (
            <Button onPress={onClearSearch} variant="outline" className="mb-3">
              🗑️ Limpar busca
            </Button>
          )}
          <Button
            onPress={onRefresh}
            loading={refreshing}
            disabled={refreshing}
          >
            {refreshing ? "Atualizando..." : "🔄 Atualizar lista"}
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 mt-10 items-center px-8">
      {/* Animated illustration */}
      <View className="relative mb-8">
        <View
          className="w-32 h-32 bg-gradient-to-br
          from-primary-100 to-primary-200
          rounded-3xl items-center justify-center"
        >
          <Text className="text-6xl">🚗</Text>
        </View>
        {/* Floating elements */}
        <View
          className="absolute -top-2 -right-2 w-8 h-8
          bg-primary-500 rounded-full items-center justify-center"
        >
          <Text className="text-white text-xs font-bold">+</Text>
        </View>
        <View
          className="absolute -bottom-2 -left-2
          w-6 h-6 bg-gray-300 rounded-full"
        />
      </View>

      <Text className="text-2xl font-bold text-gray-900 mb-3 text-center">
        Sua frota aguarda! 🚀
      </Text>
      <Text
        className="text-gray-600 text-center
        mb-8 text-base leading-6 max-w-sm"
      >
        Ainda não há veículos cadastrados. Que tal começar a construir sua
        frota?
      </Text>

      {/* Action buttons */}
      <View className="w-full max-w-xs">
        <Button
          onPress={onRefresh}
          loading={refreshing}
          disabled={refreshing}
          className="mb-3"
        >
          {refreshing ? "Atualizando..." : "🔄 Atualizar lista"}
        </Button>
        {onOpenWebPlatform && (
          <TouchableOpacity
            className="py-3"
            onPress={onOpenWebPlatform}
            disabled={refreshing}
          >
            <Text
              className={`text-center font-medium ${
                refreshing ? "text-gray-400" : "text-primary-600"
              }`}
            >
              🚚 Cadastre novos veículos na plataforma web!
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Decorative dots */}
      <View className="flex-row items-center mt-8 space-x-2">
        <View className="w-2 h-2 bg-primary-200 rounded-full" />
        <View className="w-3 h-3 bg-primary-400 rounded-full" />
        <View className="w-2 h-2 bg-primary-200 rounded-full" />
      </View>
    </View>
  );
};
