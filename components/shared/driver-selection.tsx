import { useState, useCallback } from "react";

import { FlatList, View, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useDebounce, useDriverInfiniteScroll } from "../../hooks";
import type { Driver } from "../../hooks/use-driver-infinite-scroll";

import { LoadingSpinner, Button, Input } from "../ui";
import { useThemeColors } from "../../hooks/use-theme";

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
  const colors = useThemeColors();
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
          text-ink mb-4 text-center"
        >
          Erro ao carregar motoristas
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
          placeholder="Buscar motorista por nome ou CNH..."
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

      {/* Selected Driver Indicator */}
      {selectedDriverId && (
        <View
          className="mb-4 p-3 bg-success-soft
          rounded-lg border border-success/40"
        >
          <Text className="text-sm text-success font-medium">
            ✓ Motorista selecionado
          </Text>
        </View>
      )}

      {/* Driver List */}
      {isLoading ? (
        <LoadingSpinner text="Carregando motoristas..." />
      ) : filteredDrivers.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-muted text-center">
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
              className={`rounded-lg p-4 mb-3 border ${
                selectedDriverId === driver.id
                  ? "border-primary bg-primary-soft"
                  : "border-border bg-card"
              } ${driver.status === "ACTIVE" ? "opacity-100" : "opacity-50"}`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-bold text-ink mb-1">
                    {driver.name}
                  </Text>
                  <Text className="text-sm text-muted mb-1">
                    CNH: {driver.cnh}
                  </Text>
                  <Text className="text-xs text-muted">
                    {driver.status === "ACTIVE" ? "Ativo" : "Inativo"}
                  </Text>
                </View>
                {selectedDriverId === driver.id && (
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
