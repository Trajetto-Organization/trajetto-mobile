import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import { useAuthStore } from "../../store";
import { useBusinessInfiniteScroll } from "../../hooks";

import { ProtectedRoute } from "../../components/protected-route";
import { BusinessCard } from "../../components/business-card";

import { Header } from "../../components/header";

import {
  LoadingSpinner,
  VehicleSkeletonList,
  Button,
  LogoutModal,
  Input,
} from "../../components/ui";

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

  const hasSearchResults = debouncedSearch && debouncedSearch.length > 0;
  const showNoResults =
    hasSearchResults && businesses.length === 0 && !isLoading;

  const renderBusinessItem = ({ item }: { item: Business }) => (
    <BusinessCard business={item} onPress={() => handleBusinessPress(item)} />
  );

  const renderFooter = () => {
    if (!hasNextPage) return null;

    return (
      <View className="py-4">
        {isFetching ? (
          <LoadingSpinner size="small" text="Carregando mais empresas..." />
        ) : null}
      </View>
    );
  };

  const renderEmpty = () => {
    if (isLoading) return null;

    // Show search no results state
    if (showNoResults) {
      return (
        <View className="flex-1 mt-16 items-center px-8">
          <Text
            className="text-2xl font-bold 
            text-gray-900 mb-3 text-center"
          >
            Nenhuma empresa encontrada
          </Text>
          <Text
            className="text-gray-600 text-center 
            mb-8 text-base leading-6 max-w-sm"
            numberOfLines={3}
            ellipsizeMode="tail"
          >
            Não encontramos empresas com{" "}
            <Text className="font-semibold">
              &quot;
              {debouncedSearch.length > 15
                ? debouncedSearch.substring(0, 15) + "..."
                : debouncedSearch}
              &quot;
            </Text>
            . Tente buscar por nome ou CNPJ.
          </Text>

          {/* Action buttons */}
          <View className="w-full max-w-xs">
            <Button
              onPress={handleClearSearch}
              variant="outline"
              className="mb-3"
            >
              🗑️ Limpar busca
            </Button>
            <Button
              onPress={handleRefresh}
              loading={refreshing}
              disabled={refreshing}
            >
              {refreshing ? "Atualizando..." : "🔄 Atualizar lista"}
            </Button>
          </View>
        </View>
      );
    }

    // Show default empty state
    return (
      <View className="flex-1 mt-10 items-center px-8">
        {/* Animated illustration */}
        <View className="relative mb-8">
          <View
            className="w-32 h-32 bg-gradient-to-br from-blue-100 
            to-blue-200 rounded-3xl items-center justify-center shadow-lg"
          >
            <Text className="text-6xl">🏢</Text>
          </View>
          {/* Floating elements */}
          <View
            className="absolute -top-2 -right-2 w-8 h-8 
            bg-blue-500 rounded-full items-center justify-center"
          >
            <Text className="text-white text-xs font-bold">+</Text>
          </View>
          <View
            className="absolute -bottom-2 -left-2 
            w-6 h-6 bg-gray-300 rounded-full"
          />
        </View>

        <Text
          className="text-2xl font-bold 
          text-gray-900 mb-3 text-center"
        >
          Empresas em destaque! 🏢
        </Text>
        <Text
          className="text-gray-600 text-center 
          mb-8 text-base leading-6 max-w-sm"
        >
          Selecione a empresa que deseja gerenciar para acessar a frota de
          veículos.
        </Text>

        {/* Action buttons */}
        <View className="w-full max-w-xs">
          <Button
            onPress={handleRefresh}
            loading={refreshing}
            disabled={refreshing}
            className="mb-3"
          >
            {refreshing ? "Atualizando..." : "🔄 Atualizar lista"}
          </Button>
        </View>

        {/* Decorative dots */}
        <View className="flex-row items-center mt-8 space-x-2">
          <View className="w-2 h-2 bg-blue-200 rounded-full" />
          <View className="w-3 h-3 bg-blue-400 rounded-full" />
          <View className="w-2 h-2 bg-blue-200 rounded-full" />
        </View>
      </View>
    );
  };

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-gray-50">
        {/* Header */}
        <Header pageTitle="Selecionar Empresa" onLogout={handleLogout} />

        <View className="px-6 pt-2 pb-8">
          {/* Search Input */}
          <View className="mt-6 mb-2">
            <Input
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Buscar empresa por nome ou CNPJ..."
              placeholderTextColor="#9ca3af"
              className="bg-white/90 backdrop-blur-sm 
              border-gray-200 rounded-2xl shadow-sm"
              style={{
                fontSize: 16,
                paddingHorizontal: 20,
                paddingVertical: 16,
              }}
              rightIcon={
                searchQuery.length > 0 ? (
                  <TouchableOpacity
                    onPress={handleClearSearch}
                    className="p-1 rounded-full bg-gray-100"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={18} color="#6b7280" />
                  </TouchableOpacity>
                ) : (
                  <View className="p-1">
                    <Ionicons name="search" size={18} color="#9ca3af" />
                  </View>
                )
              }
            />
            {hasSearchResults && (
              <Text
                className="text-xs text-gray-500 mt-2 ml-4"
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {isFetching
                  ? "Buscando..."
                  : `${businesses.length} resultado${
                      businesses.length !== 1 ? "s" : ""
                    } para "${
                      debouncedSearch.length > 20
                        ? debouncedSearch.substring(0, 20) + "..."
                        : debouncedSearch
                    }"`}
              </Text>
            )}
          </View>

          {/* Stats Cards */}
          <View className="flex-row justify-center mt-4 -mb-4">
            <View className="bg-blue-50 rounded-2xl p-4 flex-1 max-w-xs">
              <Text className="text-xs font-medium mb-1 text-center">
                Total de Empresas
              </Text>
              <Text className="text-xl font-bold text-center">{total}</Text>
            </View>
          </View>
        </View>

        {/* Error State */}
        {isError && (
          <View
            className="mx-6 mt-4 bg-white rounded-2xl border 
            border-danger-100 shadow-sm overflow-hidden"
          >
            <View
              className="bg-gradient-to-r 
              from-danger-500 to-danger-600 
              px-4 py-3"
            >
              <View className="flex-row items-center">
                <View
                  className="w-8 h-8 bg-white/20 
                  rounded-full items-center 
                  justify-center mr-3"
                >
                  <Text className="text-white font-bold">⚠️</Text>
                </View>
                <Text className="text-white font-bold text-base">
                  Oops! Algo deu errado
                </Text>
              </View>
            </View>
            <View className="p-4">
              <Text className="text-gray-600 text-sm mb-4 leading-5">
                {error ||
                  "Não foi possível carregar as empresas. Verifique sua conexão e tente novamente."}
              </Text>
              <Button
                onPress={handleRefreshError}
                variant="danger"
                size="sm"
                loading={isRefreshingError}
                disabled={isRefreshingError}
                className="shadow-sm"
              >
                {isRefreshingError ? "Tentando..." : "🔄 Tentar novamente"}
              </Button>
            </View>
          </View>
        )}

        {/* Business List */}
        {isLoading ? (
          <View className="px-4 pt-6">
            <VehicleSkeletonList count={6} />
          </View>
        ) : (
          <FlatList
            data={businesses}
            renderItem={renderBusinessItem}
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
                onRefresh={handleRefresh}
                colors={["#3b82f6"]}
                tintColor="#3b82f6"
                progressViewOffset={20}
              />
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.1}
            ListFooterComponent={renderFooter}
            ListEmptyComponent={renderEmpty}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
          />
        )}

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
