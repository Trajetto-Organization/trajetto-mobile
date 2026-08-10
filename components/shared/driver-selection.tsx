import { useState, useCallback } from "react";

import { FlatList, View, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useDebounce, useDriverInfiniteScroll } from "../../hooks";
import type { Driver } from "../../hooks/use-driver-infinite-scroll";

import { LoadingSpinner, Button, Input } from "../ui";

interface DriverSelectionProps {
  businessId: string;
  selectedDriverId?: string;
  onSelectDriver: (driver: Driver) => void;
}

export const DriverSelection: React.FC<DriverSelectionProps> = ({
  businessId,
  selectedDriverId,
  onSelectDriver,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const debouncedSearch = useDebounce(searchQuery.trim());

  const {
    drivers,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useDriverInfiniteScroll(businessId, debouncedSearch);

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      loadMore();
    }
  }, [hasNextPage, isFetching, loadMore]);

  const filteredDrivers = drivers;

  if (isError) {
    return (
      <View className="flex-1 justify-center items-center px-6">
        <Text
          className="text-xl font-bold
          text-gray-900 mb-4 text-center"
        >
          Erro ao carregar motoristas
        </Text>
        <Text className="text-gray-600 text-center mb-8">{error}</Text>
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
          placeholder="Buscar motorista por nome ou CNH..."
          className="bg-white border-gray-200 rounded-2xl"
          rightIcon={
            searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close" size={18} color="#6b7280" />
              </TouchableOpacity>
            ) : (
              <Ionicons name="search" size={18} color="#9ca3af" />
            )
          }
        />
      </View>

      {/* Selected Driver Indicator */}
      {selectedDriverId && (
        <View
          className="mb-4 p-3 bg-green-50
          rounded-lg border border-green-200"
        >
          <Text className="text-sm text-green-800 font-medium">
            ✓ Motorista selecionado
          </Text>
        </View>
      )}

      {/* Driver List */}
      {isLoading ? (
        <LoadingSpinner text="Carregando motoristas..." />
      ) : filteredDrivers.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-600 text-center">
            {debouncedSearch
              ? "Nenhum motorista encontrado para esta busca"
              : "Nenhum motorista encontrado"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredDrivers}
          keyExtractor={(driver) => driver.id}
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
          renderItem={({ item: driver }) => (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{
                disabled: driver.status !== "ACTIVE",
                selected: selectedDriverId === driver.id,
              }}
              disabled={driver.status !== "ACTIVE"}
              onPress={() => onSelectDriver(driver)}
              className={`bg-white rounded-lg p-4 mb-3 border ${
                selectedDriverId === driver.id
                  ? "border-primary-500 bg-primary-50"
                  : "border-gray-200"
              } ${
                driver.status === "ACTIVE" ? "opacity-100" : "opacity-50"
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-bold text-gray-900 mb-1">
                    {driver.name}
                  </Text>
                  <Text className="text-sm text-gray-600 mb-1">
                    CNH: {driver.cnh}
                  </Text>
                  <Text className="text-xs text-gray-500">
                    {driver.status === "ACTIVE" ? "Ativo" : "Inativo"}
                  </Text>
                </View>
                {selectedDriverId === driver.id && (
                  <View
                    className="w-6 h-6 bg-primary-500
                    rounded-full items-center justify-center"
                  >
                    <Ionicons name="checkmark" size={16} color="white" />
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
