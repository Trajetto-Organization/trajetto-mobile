import { useState, useCallback, useEffect, useMemo } from "react";

import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import { useAuthStore } from "@/store";
import { useBusinessInfiniteScroll } from "@/hooks";

import { Business } from "@/hooks/use-business-infinite-scroll";

export const useSelectBusiness = () => {
  const router = useRouter();

  const { user, logout, setUser } = useAuthStore();
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const [isRefreshingError, setIsRefreshingError] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [selectingBusinessId, setSelectingBusinessId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const {
    businesses,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useBusinessInfiniteScroll();

  const filteredBusinesses = useMemo(() => {
    if (!businesses) return [];
    if (!debouncedSearch) return businesses;

    const searchLower = debouncedSearch.toLowerCase();
    return businesses.filter((business) => {
      const corporateReason = business.corporate_reason?.toLowerCase() || "";
      const fantasyName = business.fantasy_name?.toLowerCase() || "";

      const cnpj = business.cnpj?.toLowerCase() || "";
      const city = business.city?.toLowerCase() || "";

      const email = business.email?.toLowerCase() || "";

      return (
        corporateReason.includes(searchLower) ||
        fantasyName.includes(searchLower) ||
        cnpj.includes(searchLower) ||
        city.includes(searchLower) ||
        email.includes(searchLower)
      );
    });
  }, [businesses, debouncedSearch]);

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

  const handleBusinessPress = useCallback(
    async (business: Business) => {
      setSelectingBusinessId(business.id);

      try {
        const updatedUser = {
          ...user!,
          businessId: business.id,
          selectedBusiness: business.corporate_reason,
        };

        setUser(updatedUser);

        Toast.show({
          type: "success",
          text1: "Empresa selecionada",
          text2: `Agora gerenciando ${business.corporate_reason}`,
          position: "top",
        });

        router.replace("/vehicles");
      } catch (error) {
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
    } catch (error) {
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
