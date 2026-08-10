import { useState, useCallback } from "react";

import { FlatList, View, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useBranchInfiniteScroll, useDebounce } from "../../hooks";
import type { Branch } from "../../hooks/use-branch-infinite-scroll";

import { LoadingSpinner, Button, Input } from "../ui";

interface BranchSelectionProps {
  businessId: string;
  selectedBranchId?: string;
  onSelectBranch: (branch: Branch) => void;
}

export const BranchSelection: React.FC<BranchSelectionProps> = ({
  businessId,
  selectedBranchId,
  onSelectBranch,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const debouncedSearch = useDebounce(searchQuery.trim());

  const {
    branches,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useBranchInfiniteScroll(businessId, debouncedSearch);

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      loadMore();
    }
  }, [hasNextPage, isFetching, loadMore]);

  const filteredBranches = branches;

  if (isError) {
    return (
      <View
        className="flex-1 justify-center
        items-center px-6"
      >
        <Text
          className="text-xl font-bold
          text-gray-900 mb-4 text-center"
        >
          Erro ao carregar filiais
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
          placeholder="Buscar filial por nome..."
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

      {/* Selected Branch Indicator */}
      {selectedBranchId && (
        <View
          className="mb-4 p-3 bg-green-50
          rounded-lg border border-green-200"
        >
          <Text className="text-sm text-green-800 font-medium">
            ✓ Filial selecionada
          </Text>
        </View>
      )}

      {/* Branch List */}
      {isLoading ? (
        <LoadingSpinner text="Carregando filiais..." />
      ) : filteredBranches.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-600 text-center">
            {debouncedSearch
              ? "Nenhuma filial encontrada para esta busca"
              : "Nenhuma filial encontrada"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredBranches}
          keyExtractor={(branch) => branch.id}
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
          renderItem={({ item: branch }) => (
            <TouchableOpacity
              onPress={() => onSelectBranch(branch)}
              className={`bg-white rounded-lg p-4 mb-3 border ${
                selectedBranchId === branch.id
                  ? "border-primary-500 bg-primary-50"
                  : "border-gray-200"
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-bold text-gray-900 mb-1">
                    {branch.corporate_reason}
                  </Text>
                  {branch.fantasy_name && (
                    <Text className="text-sm text-gray-600 mb-2">
                      {branch.fantasy_name}
                    </Text>
                  )}
                  <Text className="text-xs text-gray-500">
                    {branch.city}, {branch.uf}
                  </Text>
                </View>
                {selectedBranchId === branch.id && (
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
