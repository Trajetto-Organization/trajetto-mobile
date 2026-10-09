import { useState, useCallback, useRef } from "react";
import { Linking } from "react-native";

import { useRouter } from "expo-router";

import { useAuthStore } from "@/store";
import { useDebounce, useVehicleInfiniteScroll } from "@/hooks";

import { Vehicle } from "@/types";
import {
  checkFuelPermission,
  checkChecklistPermission,
} from "@/utils/permissions";

import { refreshWithConnectionFeedback } from "@/utils/pull-to-refresh";

import { useAppSurfaces } from "@/features/access/use-app-surfaces";

export const useVehicles = () => {
  const router = useRouter();

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  // What "Início" is for this session (fleet list, or a state explaining
  // why not). The list is only asked for when it is the screen: a control-
  // tower operator without vehicle_manage used to collect a 403 here.
  const { home } = useAppSurfaces();
  const listsVehicles = home.kind === "fleet";

  const setUser = useAuthStore((state) => state.setUser);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const [isRefreshingError, setIsRefreshingError] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const debouncedSearch = useDebounce(searchQuery.trim());
  const [showSwitchBusinessModal, setShowSwitchBusinessModal] =
    useState<boolean>(false);

  const [isSwitchingBusiness, setIsSwitchingBusiness] =
    useState<boolean>(false);

  const [showVehicleActionModal, setShowVehicleActionModal] =
    useState<boolean>(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

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
    listsVehicles ? user?.businessId || undefined : undefined,
    debouncedSearch,
  );

  const filteredVehicles = vehicles;

  const activeVehiclesCount = filteredVehicles.filter(
    (vehicle) => vehicle.status === "ACTIVE" || vehicle.status === "IN_ROUTE",
  ).length;

  // Both already require the company to have Gestão de Frota (MOB-02): with
  // the module off the card offers nothing and the modal never opens.
  const fuelPermissions = checkFuelPermission(user);
  const checklistPermissions = checkChecklistPermission(user);

  const hasActionPermission =
    fuelPermissions.canWrite || checklistPermissions.canWrite;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setIsRefreshingError(false);

    try {
      await refreshWithConnectionFeedback(refetch);
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const handleRefreshError = useCallback(async () => {
    setIsRefreshingError(true);
    try {
      await refreshWithConnectionFeedback(refetch);
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

  // navigate (not push) on every screen-opening tap: RN fires one onPress per
  // tap and a stack happily pushes duplicates — navigate reuses the instance
  // already on the stack, so double-taps cannot pile screens up.
  const handleFuelAction = useCallback(() => {
    if (!selectedVehicle) return;

    router.navigate({
      pathname: "/fuel",
      params: { vehicleId: selectedVehicle.id },
    });
  }, [selectedVehicle, router]);

  const handleChecklistAction = useCallback(() => {
    if (!selectedVehicle) return;

    router.navigate({
      pathname: "/checklist",
      params: { vehicleId: selectedVehicle.id },
    });
  }, [selectedVehicle, router]);

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  // The "Sair" of the MASTER's pick-a-company screen waits on the same modal
  // (MOB-15: what the logout leaves behind is said first). Its promise
  // settles with the decision; a cancel rejects, which that screen already
  // reads as "back to idle".
  const masterLogoutDecision = useRef<{
    resolve: () => void;
    reject: (reason: Error) => void;
  } | null>(null);

  const closeLogoutModal = useCallback(() => {
    setShowLogoutModal(false);

    masterLogoutDecision.current?.reject(new Error("logout cancelled"));
    masterLogoutDecision.current = null;
  }, []);

  // Logout navigation is declarative: clearing the user flips the root
  // Stack.Protected guard, which already lands on /login. Replacing on top of
  // that navigated twice and remounted the login screen — the flash Gabriel
  // saw right after logging out.
  const confirmLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();

      masterLogoutDecision.current?.resolve();
      masterLogoutDecision.current = null;
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
    router.navigate("/select-business");
  }, [router]);

  const handleMasterLogout = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        masterLogoutDecision.current = { resolve, reject };
        setShowLogoutModal(true);
      }),
    [],
  );

  const isMasterWithoutBusiness = user?.role === "MASTER" && !user?.businessId;

  const isDriverWithoutVehicles =
    user?.role === "BUSINESS_USER" &&
    !!user?.driverId &&
    filteredVehicles.length === 0 &&
    !isLoading &&
    !debouncedSearch;

  const navigateToNotifications = useCallback(() => {
    router.navigate("/notifications");
  }, [router]);

  // "Início" of a deliveries-only driver: the work is one tab over.
  const navigateToDeliveries = useCallback(() => {
    router.navigate("/deliveries");
  }, [router]);

  return {
    user,
    home,
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
    closeLogoutModal,
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
    navigateToNotifications,
    navigateToDeliveries,
    handleMasterLogout,
  };
};
