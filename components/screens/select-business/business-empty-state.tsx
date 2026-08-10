import { useState } from "react";
import { View, Text } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
import { Button } from "../../ui";

interface BusinessEmptyStateProps {
  isSearchResult?: boolean;
  searchQuery?: string;
  isFetching?: boolean;
  onClearSearch?: () => void;
  onRefresh: () => void;
}

export const BusinessEmptyState: React.FC<BusinessEmptyStateProps> = ({
  isSearchResult = false,
  searchQuery = "",
  isFetching = false,
  onClearSearch,
  onRefresh,
}) => {
  const [isClearing, setIsClearing] = useState<boolean>(false);

  const handleClearSearch = () => {
    if (!onClearSearch) return;
    setIsClearing(true);
    onClearSearch();
  };

  if (isSearchResult) {
    return (
      <View className="flex-1 mt-16 items-center px-8">
        <View
          className="w-16 h-16 bg-gray-100 rounded-full
          items-center justify-center mb-4"
        >
          <Ionicons name="search-outline" size={32} color="#9ca3af" />
        </View>

        <Text
          className="text-2xl font-bold
          text-gray-900 mb-3 text-center"
        >
          Nenhuma empresa encontrada
        </Text>
        <Text
          className="text-gray-600 text-center
          mb-8 text-base leading-6 max-w-sm"
          numberOfLines={3}
          ellipsizeMode="tail"
        >
          Não encontramos empresas com{" "}
          <Text className="font-semibold">
            &quot;
            {searchQuery.length > 15
              ? searchQuery.substring(0, 15) + "..."
              : searchQuery}
            &quot;
          </Text>
          . Tente buscar por nome ou CNPJ.
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
          className="w-32 h-32 bg-gradient-to-br from-blue-100
          to-blue-200 rounded-3xl items-center justify-center shadow-lg"
        >
          <Text className="text-6xl">🏢</Text>
        </View>
        {/* Floating elements */}
        <View
          className="absolute -top-2 -right-2 w-8 h-8
          bg-blue-500 rounded-full items-center justify-center"
        >
          <Text className="text-white text-xs font-bold">+</Text>
        </View>
        <View
          className="absolute -bottom-2 -left-2
          w-6 h-6 bg-gray-300 rounded-full"
        />
      </View>

      <Text
        className="text-2xl font-bold
        text-gray-900 mb-3 text-center"
      >
        Empresas em destaque! 🏢
      </Text>
      <Text
        className="text-gray-600 text-center
        mb-8 text-base leading-6 max-w-sm"
      >
        Selecione a empresa que deseja gerenciar para acessar a frota de
        veículos.
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
        <View className="w-2 h-2 bg-blue-200 rounded-full" />
        <View className="w-3 h-3 bg-blue-400 rounded-full" />
        <View className="w-2 h-2 bg-blue-200 rounded-full" />
      </View>
    </View>
  );
};
