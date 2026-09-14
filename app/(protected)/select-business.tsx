import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProtectedRoute } from "../../components/protected-route";
import { Header } from "../../components/header";
import { StatusBanners } from "../../components/status-banners";

import { LogoutModal } from "../../components/ui";
import {
  BusinessSearch,
  BusinessStats,
  BusinessErrorState,
  BusinessList,
} from "../../components/screens/select-business";

import { useSelectBusiness } from "@/features/businesses/hooks/use-select-business";

const SelectBusinessScreen = () => {
  const {
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    filteredBusinesses,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    refreshing,
    isRefreshingError,
    selectingBusinessId,
    showLogoutModal,
    setShowLogoutModal,
    isLoggingOut,
    handleRefresh,
    handleRefreshError,
    handleLoadMore,
    handleBusinessPress,
    handleLogout,
    confirmLogout,
    handleClearSearch,
  } = useSelectBusiness();

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-gray-50">
        {/* Header */}
        <Header pageTitle="Selecionar Empresa" onLogout={handleLogout} />
        <StatusBanners />

        <View className="px-6 pt-2 pb-8">
          {/* Search Input */}
          <BusinessSearch
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onClearSearch={handleClearSearch}
            debouncedSearch={debouncedSearch}
            isFetching={isFetching}
            businessesCount={filteredBusinesses.length}
          />

          {/* Stats Cards */}
          <BusinessStats total={filteredBusinesses.length} />
        </View>

        {/* Error State */}
        {isError && (
          <BusinessErrorState
            error={error}
            isRefreshingError={isRefreshingError}
            onRetry={handleRefreshError}
          />
        )}

        {/* Business List */}
        <BusinessList
          businesses={filteredBusinesses}
          isLoading={isLoading}
          isFetching={isFetching}
          hasNextPage={hasNextPage}
          refreshing={refreshing}
          debouncedSearch={debouncedSearch}
          selectingBusinessId={selectingBusinessId}
          onBusinessPress={handleBusinessPress}
          onRefresh={handleRefresh}
          onLoadMore={handleLoadMore}
          onClearSearch={handleClearSearch}
        />

        {/* Logout Modal */}
        <LogoutModal
          visible={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={confirmLogout}
          isLoading={isLoggingOut}
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default SelectBusinessScreen;
