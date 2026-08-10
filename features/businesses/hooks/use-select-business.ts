import { useState, useCallback, useEffect, useRef } from "react";

import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import { useAuthStore } from "@/store";
import { useBusinessInfiniteScroll, useDebounce } from "@/hooks";

import { Business } from "@/hooks/use-business-infinite-scroll";

export const useSelectBusiness = () => {
  const router = useRouter();

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const setUser = useAuthStore((state) => state.setUser);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const [isRefreshingError, setIsRefreshingError] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const debouncedSearch = useDebounce(searchQuery.trim());
  const [selectingBusinessId, setSelectingBusinessId] = useState<string | null>(
    null,
  );
  const selectionInFlightRef = useRef(false);

  useEffect(() => {
    // Best effort: warm the next screen while the user chooses a business.
    // This avoids paying the first route/module initialization cost after tap.
    router.prefetch("/vehicles");
  }, [router]);

  const {
    businesses,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useBusinessInfiniteScroll(debouncedSearch);

  const filteredBusinesses = businesses;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setIsRefreshingError(false);

    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const handleRefreshError = useCallback(async () => {
    setIsRefreshingError(true);

    try {
      await refetch();
    } finally {
      setIsRefreshingError(false);
    }
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      loadMore();
    }
  }, [hasNextPage, isFetching, loadMore]);

  const handleBusinessPress = useCallback(
    (business: Business) => {
      if (selectionInFlightRef.current || !user) return;

      // State alone only disables the cards after React commits the next
      // render. The ref closes the same-frame double-tap window immediately.
      selectionInFlightRef.current = true;
      void Haptics.selectionAsync().catch(() => undefined);
      setSelectingBusinessId(business.id);

      try {
        const updatedUser = {
          ...user,
          businessId: business.id,
          selectedBusiness: business.corporate_reason,
        };

        setUser(updatedUser);
        router.replace("/vehicles");

        // Toast is useful feedback, but it is not part of the navigation's
        // critical path. Let the route replacement be processed first.
        requestAnimationFrame(() => {
          Toast.show({
            type: "success",
            text1: "Empresa selecionada",
            text2: `Agora gerenciando ${business.corporate_reason}`,
            position: "top",
          });
        });
      } catch {
        selectionInFlightRef.current = false;
        setSelectingBusinessId(null);

        Toast.show({
          type: "error",
          text1: "Erro",
          text2: "Não foi possível selecionar a empresa.",
          position: "top",
        });
      }
    },
    [user, setUser, router],
  );

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = async () => {
    setIsLoggingOut(true);

    try {
      await logout();
      router.replace("/login");
    } catch {
      setIsLoggingOut(false);
    }
  };

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  return {
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
  };
};
