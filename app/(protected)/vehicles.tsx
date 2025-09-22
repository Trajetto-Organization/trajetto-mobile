import { useState, useCallback, useEffect } from "react";
import { View, Linking } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import { useAuthStore } from "../../store";
import { useVehicleInfiniteScroll } from "../../hooks";

import { ProtectedRoute } from "../../components/protected-route";
import { Header } from "../../components/header";

import { LogoutModal, SwitchBusinessModal } from "../../components/ui";

import {
  VehicleSearch,
  VehicleStats,
  VehicleErrorState,
  MasterUserState,
  VehicleList,
} from "../../components/screens/vehicles";

import { Vehicle } from "../../types";
import { checkVehiclePermission } from "../../utils/permissions";

const VehiclesScreen = () => {
  const router = useRouter();

  const { user, logout, setUser } = useAuthStore();
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const [isRefreshingError, setIsRefreshingError] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [showSwitchBusinessModal, setShowSwitchBusinessModal] =
    useState<boolean>(false);

  const [isSwitchingBusiness, setIsSwitchingBusiness] =
    useState<boolean>(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300); // 300ms delay

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const {
    vehicles,
    total,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useVehicleInfiniteScroll(debouncedSearch || undefined);

  // Calculate active vehicles count (ACTIVE + IN_ROUTE)
  const activeVehiclesCount = vehicles.filter(
    (vehicle) => vehicle.status === "ACTIVE" || vehicle.status === "IN_ROUTE"
  ).length;

  const permissions = checkVehiclePermission(user);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setIsRefreshingError(false);

    try {
      refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const handleRefreshError = useCallback(async () => {
    setIsRefreshingError(true);
    try {
      refetch();
    } finally {
      setIsRefreshingError(false);
    }
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      loadMore();
    }
  }, [hasNextPage, isFetching, loadMore]);

  const handleVehiclePress = useCallback(
    (vehicle: Vehicle) => {
      if (!permissions.canWrite) {
        Toast.show({
          type: "info",
          text1: "Acesso limitado",
          text2: "Você só pode visualizar os veículos.",
          position: "top",
        });

        return;
      }

      // Check if vehicle can be refueled
      if (vehicle.status === "INACTIVE") {
        Toast.show({
          type: "error",
          text1: "Veículo inativo",
          text2: "Este veículo está inativo e não pode ser abastecido.",
          position: "top",
        });

        return;
      }

      if (vehicle.status === "BLOCKED") {
        Toast.show({
          type: "error",
          text1: "Veículo bloqueado",
          text2: "Este veículo está bloqueado e não pode ser abastecido.",
          position: "top",
        });

        return;
      }

      // Only allow refueling for ACTIVE and IN_ROUTE vehicles
      if (vehicle.status === "ACTIVE" || vehicle.status === "IN_ROUTE") {
        router.push({
          pathname: "/fuel",
          params: { vehicleId: vehicle.id },
        });
      }
    },
    [permissions.canWrite, router]
  );

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      router.replace("/login");
    } catch (error) {
      setIsLoggingOut(false);
    }
  };

  const handleSwitchBusiness = () => {
    setShowSwitchBusinessModal(true);
  };

  const confirmSwitchBusiness = async () => {
    setIsSwitchingBusiness(true);
    try {
      // Add a small delay to show the loading state
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clear business selection from user
      const updatedUser = {
        ...user!,
        businessId: undefined,
        selectedBusiness: undefined,
      };

      setUser(updatedUser);

      // Close modal and navigate
      setShowSwitchBusinessModal(false);
      router.replace("/select-business");
    } catch (error) {
      setIsSwitchingBusiness(false);
    } finally {
      setIsSwitchingBusiness(false);
    }
  };

  const openWebPlatform = async () => {
    const webUrl = process.env.EXPO_PUBLIC_WEB_APPLICATION_URL;
    if (webUrl) {
      try {
        await Linking.openURL(webUrl);
      } catch (error) {}
    }
  };

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  // Handle MASTER user without business selection
  if (user?.role === "MASTER" && !user?.businessId) {
    return (
      <MasterUserState
        onSelectBusiness={() => router.push("/select-business")}
        onLogout={async () => {
          await logout();
          router.replace("/login");
        }}
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
            vehiclesCount={vehicles.length}
          />

          {/* Stats Cards */}
          <VehicleStats total={total} activeCount={activeVehiclesCount} />
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
          vehicles={vehicles}
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
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default VehiclesScreen;
