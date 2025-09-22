import { FlatList, RefreshControl, View } from "react-native";
import { VehicleCard } from "../../vehicle-card";

import { LoadingSpinner, VehicleSkeletonList } from "../../ui";
import { VehicleEmptyState } from "./vehicle-empty-state";

import { Vehicle } from "../../../types";

interface VehicleListProps {
  vehicles: Vehicle[];
  isLoading: boolean;
  isFetching: boolean;
  hasNextPage: boolean;
  refreshing: boolean;
  debouncedSearch: string;
  onVehiclePress: (vehicle: Vehicle) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onClearSearch: () => void;
  onOpenWebPlatform: () => void;
}

export const VehicleList: React.FC<VehicleListProps> = ({
  vehicles,
  isLoading,
  isFetching,
  hasNextPage,
  refreshing,
  debouncedSearch,
  onVehiclePress,
  onRefresh,
  onLoadMore,
  onClearSearch,
  onOpenWebPlatform,
}) => {
  const hasSearchResults = Boolean(
    debouncedSearch && debouncedSearch.length > 0
  );
  const showNoResults = hasSearchResults && vehicles.length === 0 && !isLoading;

  const renderVehicleItem = ({ item }: { item: Vehicle }) => (
    <VehicleCard vehicle={item} onRefuel={() => onVehiclePress(item)} />
  );

  const renderFooter = () => {
    if (!hasNextPage) return null;

    return (
      <View className="py-4">
        {isFetching ? (
          <LoadingSpinner size="small" text="Carregando mais veículos..." />
        ) : null}
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;

    return (
      <VehicleEmptyState
        isSearchResult={showNoResults}
        searchQuery={debouncedSearch}
        refreshing={refreshing}
        onClearSearch={showNoResults ? onClearSearch : undefined}
        onRefresh={onRefresh}
        onOpenWebPlatform={!showNoResults ? onOpenWebPlatform : undefined}
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
      data={vehicles}
      renderItem={renderVehicleItem}
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
      ListEmptyComponent={renderEmpty}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
    />
  );
};
