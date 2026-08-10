import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProtectedRoute } from "../../components/protected-route";
import { Header } from "../../components/header";

import {
  LogoutModal,
  SwitchBusinessModal,
  VehicleActionModal,
} from "../../components/ui";
import {
  VehicleSearch,
  VehicleStats,
  VehicleErrorState,
  MasterUserState,
  VehicleList,
} from "../../components/screens/vehicles";

import { useVehicles } from "@/features/vehicles/hooks/use-vehicles";

const VehiclesScreen = () => {
  const {
    user,
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    filteredVehicles,
    activeVehiclesCount,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    refreshing,
    isRefreshingError,
    showLogoutModal,
    setShowLogoutModal,
    isLoggingOut,
    showSwitchBusinessModal,
    setShowSwitchBusinessModal,
    isSwitchingBusiness,
    showVehicleActionModal,
    setShowVehicleActionModal,
    selectedVehicle,
    setSelectedVehicle,
    fuelPermissions,
    checklistPermissions,
    hasActionPermission,
    isMasterWithoutBusiness,
    isDriverWithoutVehicles,
    handleRefresh,
    handleRefreshError,
    handleLoadMore,
    handleVehiclePress,
    handleFuelAction,
    handleChecklistAction,
    handleLogout,
    confirmLogout,
    handleSwitchBusiness,
    confirmSwitchBusiness,
    openWebPlatform,
    handleClearSearch,
    navigateToSelectBusiness,
    handleMasterLogout,
  } = useVehicles();

  if (isMasterWithoutBusiness) {
    return (
      <MasterUserState
        onSelectBusiness={navigateToSelectBusiness}
        onLogout={handleMasterLogout}
      />
    );
  }

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-gray-50">
        {/* Header */}
        <Header
          pageTitle="Gerenciar Veículos"
          onLogout={handleLogout}
          onSwitchBusiness={
            user?.role === "MASTER" ? handleSwitchBusiness : undefined
          }
        />
        <View className="px-6 pt-2 pb-8">
          {/* Search Input */}
          <VehicleSearch
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onClearSearch={handleClearSearch}
            debouncedSearch={debouncedSearch}
            isFetching={isFetching}
            vehiclesCount={filteredVehicles.length}
          />

          {/* Stats Cards */}
          <VehicleStats
            total={filteredVehicles.length}
            activeCount={activeVehiclesCount}
          />
        </View>

        {/* Error State */}
        {isError && (
          <VehicleErrorState
            error={error}
            isRefreshingError={isRefreshingError}
            onRetry={handleRefreshError}
          />
        )}

        {/* Vehicle List */}
        <VehicleList
          vehicles={filteredVehicles}
          isLoading={isLoading}
          isFetching={isFetching}
          hasNextPage={hasNextPage}
          refreshing={refreshing}
          debouncedSearch={debouncedSearch}
          onVehiclePress={handleVehiclePress}
          onRefresh={handleRefresh}
          onLoadMore={handleLoadMore}
          onClearSearch={handleClearSearch}
          onOpenWebPlatform={openWebPlatform}
          hasActionPermission={hasActionPermission}
          isDriverWithoutVehicles={isDriverWithoutVehicles}
        />

        {/* Logout Modal */}
        <LogoutModal
          visible={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={confirmLogout}
          isLoading={isLoggingOut}
        />

        {/* Switch Business Modal */}
        <SwitchBusinessModal
          visible={showSwitchBusinessModal}
          onClose={() => setShowSwitchBusinessModal(false)}
          onConfirm={confirmSwitchBusiness}
          currentBusiness={user?.selectedBusiness as string}
          isLoading={isSwitchingBusiness}
        />

        {/* Vehicle Action Modal */}
        <VehicleActionModal
          visible={showVehicleActionModal}
          vehicle={selectedVehicle}
          canFuel={fuelPermissions.canWrite}
          canChecklist={checklistPermissions.canWrite}
          onClose={() => {
            setShowVehicleActionModal(false);
            setSelectedVehicle(null);
          }}
          onFuelAction={handleFuelAction}
          onChecklistAction={handleChecklistAction}
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default VehiclesScreen;
