import { useState, useCallback, useEffect } from "react";

import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useDriverInfiniteScroll } from "../../hooks";
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
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { drivers, isLoading, isError, error, hasNextPage, loadMore, refetch } =
    useDriverInfiniteScroll(debouncedSearch || undefined);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isLoading) {
      loadMore();
    }
  }, [hasNextPage, isLoading, loadMore]);

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
      ) : drivers.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-600 text-center">
            Nenhum motorista encontrado
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScrollEndDrag={handleLoadMore}
        >
          {drivers.map((driver) => (
            <TouchableOpacity
              key={driver.id}
              onPress={() => onSelectDriver(driver)}
              className={`bg-white rounded-lg p-4 mb-3 border ${
                selectedDriverId === driver.id
                  ? "border-primary-500 bg-primary-50"
                  : "border-gray-200"
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
                    {driver.city}, {driver.uf}
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
          ))}
        </ScrollView>
      )}
    </View>
  );
};
