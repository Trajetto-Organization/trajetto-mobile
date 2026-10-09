import { useState, useCallback } from "react";

import { FlatList, View, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useBranchInfiniteScroll, useDebounce } from "../../hooks";
import type { Branch } from "../../hooks/use-branch-infinite-scroll";

import { LoadingSpinner, Button, Input } from "../ui";
import { useThemeColors } from "../../hooks/use-theme";

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
  const colors = useThemeColors();
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
          text-ink mb-4 text-center"
        >
          Erro ao carregar filiais
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
          placeholder="Buscar filial por nome..."
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

      {/* Selected Branch Indicator */}
      {selectedBranchId && (
        <View
          className="mb-4 p-3 bg-success-soft
          rounded-lg border border-success/40"
        >
          <Text className="text-sm text-success font-medium">
            ✓ Filial selecionada
          </Text>
        </View>
      )}

      {/* Branch List */}
      {isLoading ? (
        <LoadingSpinner text="Carregando filiais..." />
      ) : filteredBranches.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-muted text-center">
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
              className={`rounded-lg p-4 mb-3 border ${
                selectedBranchId === branch.id
                  ? "border-primary bg-primary-soft"
                  : "border-border bg-card"
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-bold text-ink mb-1">
                    {branch.corporate_reason}
                  </Text>
                  {branch.fantasy_name && (
                    <Text className="text-sm text-muted mb-2">
                      {branch.fantasy_name}
                    </Text>
                  )}
                  <Text className="text-xs text-muted">
                    {branch.city}, {branch.uf}
                  </Text>
                </View>
                {selectedBranchId === branch.id && (
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
