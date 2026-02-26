import { useState, useCallback, useEffect, useMemo } from "react";

import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useBranchInfiniteScroll } from "../../hooks";
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
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const {
    branches,
    isLoading,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useBranchInfiniteScroll(businessId);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isLoading) {
      loadMore();
    }
  }, [hasNextPage, isLoading, loadMore]);

  // Filter branches locally based on search query
  const filteredBranches = useMemo(() => {
    if (!branches) return [];
    if (!debouncedSearch) return branches;

    const searchLower = debouncedSearch.toLowerCase();
    return branches.filter((branch) => {
      const corporateReason = branch.corporate_reason?.toLowerCase() || "";
      const fantasyName = branch.fantasy_name?.toLowerCase() || "";

      const city = branch.city?.toLowerCase() || "";
      const cnpj = branch.cnpj?.toLowerCase() || "";

      return (
        corporateReason.includes(searchLower) ||
        fantasyName.includes(searchLower) ||
        city.includes(searchLower) ||
        cnpj.includes(searchLower)
      );
    });
  }, [branches, debouncedSearch]);

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
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScrollEndDrag={handleLoadMore}
        >
          {filteredBranches.map((branch) => (
            <TouchableOpacity
              key={branch.id}
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
          ))}
        </ScrollView>
      )}
    </View>
  );
};
