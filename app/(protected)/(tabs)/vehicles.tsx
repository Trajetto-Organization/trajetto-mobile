import { Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../../components/protected-route";
import { Header } from "../../../components/header";
import { StatusBanners } from "../../../components/status-banners";

import {
  LogoutModal,
  SwitchBusinessModal,
  VehicleActionModal,
} from "../../../components/ui";
import {
  VehicleSearch,
  VehicleStats,
  VehicleErrorState,
  MasterUserState,
  VehicleList,
} from "../../../components/screens/vehicles";

import { useVehicles } from "@/features/vehicles/hooks/use-vehicles";

const VehiclesScreen = () => {
  const router = useRouter();

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
      {/* Bottom edge left to the tab bar: it pads the gesture area itself,
      and padding it twice opens a gray gap above the pill. */}
      <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-gray-50">
        {/* Header */}
        {/* The business switch left the navbar: a named card below the
        stats says what it is, where a lone building icon did not. */}
        <Header pageTitle="Gerenciar Veículos" onLogout={handleLogout} />
        <StatusBanners />
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

          {/* Master picks which company this screen is looking at —
          same card pattern as the deliveries entry below. */}
          {user?.role === "MASTER" && (
            <TouchableOpacity
              onPress={handleSwitchBusiness}
              accessibilityRole="button"
              accessibilityLabel="Trocar de empresa"
              className="mt-8 -mb-4 flex-row items-center justify-between
              rounded-xl border border-blue-200 bg-blue-50 p-4"
            >
              <View className="flex-row items-center">
                <View
                  className="mr-3 h-10 w-10 items-center justify-center
                  rounded-full bg-blue-100"
                >
                  <Ionicons name="business-outline" size={20} color="#2563eb" />
                </View>
                <View>
                  <Text className="text-base font-semibold text-gray-900">
                    Empresa selecionada
                  </Text>
                  <Text className="text-xs text-gray-500" numberOfLines={1}>
                    {(user?.selectedBusiness as string) ||
                      "Toque para escolher a empresa"}
                  </Text>
                </View>
              </View>
              <Ionicons name="swap-horizontal" size={20} color="#2563eb" />
            </TouchableOpacity>
          )}

          {/* Deliveries and chat moved to the glass tab bar below — the
          hub keeps only what has no tab of its own. */}
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
