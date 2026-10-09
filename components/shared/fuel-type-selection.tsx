import { useState, useCallback } from "react";

import { FlatList, View, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useDebounce, useFuelTypeInfiniteScroll } from "../../hooks";
import type { FuelType } from "../../hooks/use-fuel-type-infinite-scroll";

import { LoadingSpinner, Button, Input } from "../ui";
import { useThemeColors } from "../../hooks/use-theme";

interface FuelTypeSelectionProps {
  businessId: string;
  selectedFuelTypeId?: string;
  onSelectFuelType: (fuelType: FuelType) => void;
}

export const FuelTypeSelection: React.FC<FuelTypeSelectionProps> = ({
  businessId,
  selectedFuelTypeId,
  onSelectFuelType,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const colors = useThemeColors();
  const debouncedSearch = useDebounce(searchQuery.trim());

  const {
    fuelTypes,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useFuelTypeInfiniteScroll(businessId, debouncedSearch);

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      loadMore();
    }
  }, [hasNextPage, isFetching, loadMore]);

  const filteredFuelTypes = fuelTypes;

  if (isError) {
    return (
      <View className="flex-1 justify-center items-center px-6">
        <Text
          className="text-xl font-bold
          text-ink mb-4 text-center"
        >
          Erro ao carregar tipos de combustível
        </Text>
        <Text className="text-muted text-center mb-8">{error}</Text>
        <Button onPress={handleRefresh}>Tentar novamente</Button>
      </View>
    );
  }

  return (
    <View className="flex-1 px-6 pt-6">
      {/* Search Input */}
      <View className="mb-6">
        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Buscar tipo de combustível..."
          className="rounded-2xl"
          rightIcon={
            searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close" size={18} color={colors.muted} />
              </TouchableOpacity>
            ) : (
              <Ionicons name="search" size={18} color={colors.muted} />
            )
          }
        />
      </View>

      {/* Selected Fuel Type Indicator */}
      {selectedFuelTypeId && (
        <View
          className="mb-4 p-3 bg-success-soft
          rounded-lg border border-success/40"
        >
          <Text className="text-sm text-success font-medium">
            ✓ Tipo de combustível selecionado
          </Text>
        </View>
      )}

      {/* Fuel Type List */}
      {isLoading ? (
        <LoadingSpinner text="Carregando tipos de combustível..." />
      ) : filteredFuelTypes.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-muted text-center">
            {debouncedSearch
              ? "Nenhum tipo de combustível encontrado para esta busca"
              : "Nenhum tipo de combustível encontrado"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredFuelTypes}
          keyExtractor={(fuelType) => fuelType.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.35}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          ListFooterComponent={
            isFetching && hasNextPage ? (
              <View className="py-3">
                <LoadingSpinner size="small" />
              </View>
            ) : null
          }
          renderItem={({ item: fuelType }) => (
            <TouchableOpacity
              onPress={() => onSelectFuelType(fuelType)}
              className={`rounded-lg p-4 mb-3 border ${
                selectedFuelTypeId === fuelType.id
                  ? "border-primary bg-primary-soft"
                  : "border-border bg-card"
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-bold text-ink">
                    {fuelType.description}
                  </Text>
                </View>
                {selectedFuelTypeId === fuelType.id && (
                  <View
                    className="w-6 h-6 bg-primary
                    rounded-full items-center justify-center"
                  >
                    <Ionicons name="checkmark" size={16} color={colors.primaryForeground} />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
};
