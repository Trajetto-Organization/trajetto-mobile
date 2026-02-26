import { FlatList, RefreshControl, View } from "react-native";
import { BusinessCard } from "../../business-card";

import { LoadingSpinner, VehicleSkeletonList } from "../../ui";
import { BusinessEmptyState } from "./business-empty-state";

import { Business } from "../../../hooks/use-business-infinite-scroll";

interface BusinessListProps {
  businesses: Business[];
  isLoading: boolean;
  isFetching: boolean;
  hasNextPage: boolean;
  refreshing: boolean;
  debouncedSearch: string;
  selectingBusinessId: string | null;
  onBusinessPress: (business: Business) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onClearSearch: () => void;
}

export const BusinessList: React.FC<BusinessListProps> = ({
  businesses,
  isLoading,
  isFetching,
  hasNextPage,
  refreshing,
  debouncedSearch,
  selectingBusinessId,
  onBusinessPress,
  onRefresh,
  onLoadMore,
  onClearSearch,
}) => {
  const hasSearchResults = Boolean(
    debouncedSearch && debouncedSearch.length > 0,
  );
  const showNoResults =
    hasSearchResults && businesses.length === 0 && !isLoading;

  const renderBusinessItem = ({ item }: { item: Business }) => (
    <BusinessCard
      business={item}
      onPress={() => onBusinessPress(item)}
      isSelecting={selectingBusinessId === item.id}
      disabled={selectingBusinessId !== null && selectingBusinessId !== item.id}
    />
  );

  const renderFooter = () => {
    if (!hasNextPage) return null;

    return (
      <View className="py-4">
        {isFetching ? (
          <LoadingSpinner size="small" text="Carregando mais empresas..." />
        ) : null}
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;

    return (
      <BusinessEmptyState
        isSearchResult={showNoResults}
        searchQuery={debouncedSearch}
        isFetching={isFetching}
        onClearSearch={showNoResults ? onClearSearch : undefined}
        onRefresh={onRefresh}
      />
    );
  };

  if (isLoading) {
    return (
      <View className="px-4 pt-6">
        <VehicleSkeletonList count={6} />
      </View>
    );
  }

  return (
    <FlatList
      data={businesses}
      renderItem={renderBusinessItem}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{
        paddingTop: 24,
        paddingBottom: 32,
        paddingHorizontal: 16,
        flexGrow: 1,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={["#3b82f6"]}
          tintColor="#3b82f6"
          progressViewOffset={20}
        />
      }
      onEndReached={onLoadMore}
      onEndReachedThreshold={0.1}
      ListFooterComponent={renderFooter}
      ListEmptyComponent={renderEmpty()}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
    />
  );
};
