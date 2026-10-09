import { useState } from "react";
import { View, Text, Pressable } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
import { Button } from "../../ui";
import { useThemeColors } from "@/hooks/use-theme";

interface VehicleEmptyStateProps {
  isSearchResult?: boolean;
  searchQuery?: string;
  isFetching?: boolean;
  onClearSearch?: () => void;
  onRefresh: () => void;
  onOpenWebPlatform?: () => void;
  isDriverWithoutVehicles?: boolean;
}

export const VehicleEmptyState: React.FC<VehicleEmptyStateProps> = ({
  isSearchResult = false,
  searchQuery = "",
  isFetching = false,
  onClearSearch,
  onRefresh,
  onOpenWebPlatform,
  isDriverWithoutVehicles = false,
}) => {
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const colors = useThemeColors();

  const handleClearSearch = () => {
    if (!onClearSearch) return;

    setIsClearing(true);
    onClearSearch();
  };

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
            <Text className="text-6xl text-ink">🚗</Text>
          </View>
          {/* Floating elements */}
          <View
            className="absolute -top-2 -right-2 w-10 h-10
            bg-primary rounded-full items-center justify-center"
          >
            <Text className="text-primary-foreground text-xs font-bold">+</Text>
          </View>
        </View>

        <Text
          className="text-2xl font-bold 
        text-ink mb-3 text-center"
        >
          Aguardando veículos 🔑
        </Text>
        <Text
          className="text-muted text-center
          mb-8 text-base leading-6 max-w-sm"
        >
          Ainda não há veículos associados ao seu perfil de motorista. Entre em
          contato com o administrador para que veículos sejam vinculados a você.
        </Text>

        {/* Action buttons */}
        <View className="w-full max-w-xs">
          <Button
            onPress={onRefresh}
            loading={isFetching}
            disabled={isFetching}
            className="mb-3"
          >
            {isFetching ? "Atualizando..." : "Atualizar lista"}
          </Button>
        </View>

        {/* Decorative dots */}
        <View className="flex-row items-center mt-8 space-x-2">
          <View className="w-2 h-2 bg-primary/30 rounded-full" />
          <View className="w-3 h-3 bg-primary/60 rounded-full" />
          <View className="w-2 h-2 bg-primary/30 rounded-full" />
        </View>
      </View>
    );
  }

  if (isSearchResult) {
    return (
      <View className="flex-1 mt-16 items-center px-8">
        <View
          className="w-16 h-16 bg-subtle rounded-full
          items-center justify-center mb-4"
        >
          <Ionicons name="search-outline" size={32} color={colors.muted} />
        </View>

        <Text
          className="text-2xl font-bold
          text-ink mb-3 text-center"
        >
          Nenhum resultado encontrado
        </Text>
        <Text
          className="text-muted text-center
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
            <Button
              onPress={handleClearSearch}
              variant="outline"
              className="mb-3"
              loading={isClearing}
              disabled={isClearing || isFetching}
            >
              {isClearing ? "Limpando..." : "Limpar busca"}
            </Button>
          )}
          <Button
            onPress={onRefresh}
            loading={isFetching}
            disabled={isFetching || isClearing}
          >
            {isFetching ? "Atualizando..." : "Atualizar lista"}
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
          className="w-32 h-32 bg-primary-soft
          rounded-3xl items-center justify-center"
        >
          <Text className="text-6xl text-ink">🚗</Text>
        </View>
        {/* Floating elements */}
        <View
          className="absolute -top-2 -right-2 w-8 h-8
          bg-primary rounded-full items-center justify-center"
        >
          <Text className="text-primary-foreground text-xs font-bold">+</Text>
        </View>
        <View
          className="absolute -bottom-2 -left-2
          w-6 h-6 bg-border rounded-full"
        />
      </View>

      <Text className="text-2xl font-bold text-ink mb-3 text-center">
        Sua frota aguarda! 🚀
      </Text>
      <Text
        className="text-muted text-center
        mb-8 text-base leading-6 max-w-sm"
      >
        Ainda não há veículos cadastrados. Que tal começar a construir sua
        frota?
      </Text>

      {/* Action buttons */}
      <View className="w-full max-w-xs">
        <Button
          onPress={onRefresh}
          loading={isFetching}
          disabled={isFetching}
          className="mb-3"
        >
          {isFetching ? "Atualizando..." : "Atualizar lista"}
        </Button>
        {onOpenWebPlatform && (
          <Pressable
            onPress={onOpenWebPlatform}
            disabled={isFetching}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            className="py-3"
          >
            <Text
              className={`text-center font-medium ${
                isFetching ? "text-muted" : "text-primary"
              }`}
            >
              Cadastre novos veículos na plataforma web
            </Text>
          </Pressable>
        )}
      </View>

      {/* Decorative dots */}
      <View className="flex-row items-center mt-8 space-x-2">
        <View className="w-2 h-2 bg-primary/30 rounded-full" />
        <View className="w-3 h-3 bg-primary/60 rounded-full" />
        <View className="w-2 h-2 bg-primary/30 rounded-full" />
      </View>
    </View>
  );
};
