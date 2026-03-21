import { useState, useCallback, useEffect, useMemo } from "react";
import { Linking } from "react-native";

import { useRouter } from "expo-router";

import { useAuthStore } from "@/store";
import { useVehicleInfiniteScroll } from "@/hooks";

import { Vehicle } from "@/types";
import {
  checkFuelPermission,
  checkChecklistPermission,
} from "@/utils/permissions";

export const useVehicles = () => {
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

  const [showVehicleActionModal, setShowVehicleActionModal] =
    useState<boolean>(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const {
    vehicles,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useVehicleInfiniteScroll(
    user?.businessId || user?.selectedBusiness || undefined,
  );

  const filteredVehicles = useMemo(() => {
    if (!vehicles) return [];
    if (!debouncedSearch) return vehicles;

    const searchLower = debouncedSearch.toLowerCase();
    return vehicles.filter((vehicle) => {
      const licensePlate = vehicle.license_plate?.toLowerCase() || "";
      const model = vehicle.model?.toLowerCase() || "";

      const brand = vehicle.brand?.toLowerCase() || "";
      const description = vehicle.description?.toLowerCase() || "";

      const renavam = vehicle.renavam?.toLowerCase() || "";

      return (
        licensePlate.includes(searchLower) ||
        model.includes(searchLower) ||
        brand.includes(searchLower) ||
        description.includes(searchLower) ||
        renavam.includes(searchLower)
      );
    });
  }, [vehicles, debouncedSearch]);

  const activeVehiclesCount = filteredVehicles.filter(
    (vehicle) => vehicle.status === "ACTIVE" || vehicle.status === "IN_ROUTE",
  ).length;

  const fuelPermissions = checkFuelPermission(user);
  const checklistPermissions = checkChecklistPermission(user);

  const hasActionPermission =
    fuelPermissions.canWrite || checklistPermissions.canWrite;

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

  const handleVehiclePress = useCallback((vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setShowVehicleActionModal(true);
  }, []);

  const handleFuelAction = useCallback(() => {
    if (!selectedVehicle) return;

    router.push({
      pathname: "/fuel",
      params: { vehicleId: selectedVehicle.id },
    });
  }, [selectedVehicle, router]);

  const handleChecklistAction = useCallback(() => {
    if (!selectedVehicle) return;

    router.push({
      pathname: "/checklist",
      params: { vehicleId: selectedVehicle.id },
    });
  }, [selectedVehicle, router]);

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
      await new Promise((resolve) => setTimeout(resolve, 200));
      const updatedUser = {
        ...user!,
        businessId: undefined,
        selectedBusiness: undefined,
      };

      setUser(updatedUser);

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

  const navigateToSelectBusiness = useCallback(() => {
    router.push("/select-business");
  }, [router]);

  const handleMasterLogout = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [logout, router]);

  const isMasterWithoutBusiness = user?.role === "MASTER" && !user?.businessId;

  const isDriverWithoutVehicles =
    user?.role === "BUSINESS_USER" &&
    !!user?.driverId &&
    filteredVehicles.length === 0 &&
    !isLoading &&
    !debouncedSearch;

  return {
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
  };
};
