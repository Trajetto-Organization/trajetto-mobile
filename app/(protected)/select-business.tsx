import { useState, useCallback, useEffect } from "react";
import { View } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import { useAuthStore } from "../../store";
import { useBusinessInfiniteScroll } from "../../hooks";

import { ProtectedRoute } from "../../components/protected-route";
import { Header } from "../../components/header";

import { LogoutModal } from "../../components/ui";

import {
  BusinessSearch,
  BusinessStats,
  BusinessErrorState,
  BusinessList,
} from "../../components/screens/select-business";

import { Business } from "../../hooks/use-business-infinite-scroll";

const SelectBusinessScreen = () => {
  const router = useRouter();

  const { user, logout, setUser } = useAuthStore();
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const [isRefreshingError, setIsRefreshingError] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300); // 300ms delay

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const {
    businesses,
    total,
    isLoading,
    isFetching,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useBusinessInfiniteScroll(debouncedSearch || undefined);

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
      try {
        // Update user with selected business
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

        // Navigate to vehicles screen
        router.replace("/vehicles");
      } catch (error) {
        Toast.show({
          type: "error",
          text1: "Erro",
          text2: "Não foi possível selecionar a empresa.",
          position: "top",
        });
      }
    },
    [user, setUser, router]
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

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-gray-50">
        {/* Header */}
        <Header pageTitle="Selecionar Empresa" onLogout={handleLogout} />

        <View className="px-6 pt-2 pb-8">
          {/* Search Input */}
          <BusinessSearch
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onClearSearch={handleClearSearch}
            debouncedSearch={debouncedSearch}
            isFetching={isFetching}
            businessesCount={businesses.length}
          />

          {/* Stats Cards */}
          <BusinessStats total={total} />
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
          businesses={businesses}
          isLoading={isLoading}
          isFetching={isFetching}
          hasNextPage={hasNextPage}
          refreshing={refreshing}
          debouncedSearch={debouncedSearch}
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
