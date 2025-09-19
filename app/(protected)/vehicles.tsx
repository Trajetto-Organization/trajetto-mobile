import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Linking,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";

import { useAuthStore } from "../../store";
import { useVehicleInfiniteScroll } from "../../hooks";

import { ProtectedRoute } from "../../components/protected-route";
import { VehicleCard } from "../../components/vehicle-card";

import { Header } from "../../components/header";

import {
  LoadingSpinner,
  VehicleSkeletonList,
  Button,
  LogoutModal,
  Input,
  SwitchBusinessModal,
} from "../../components/ui";

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

  const hasSearchResults = debouncedSearch && debouncedSearch.length > 0;
  const showNoResults = hasSearchResults && vehicles.length === 0 && !isLoading;

  const renderVehicleItem = ({ item }: { item: Vehicle }) => (
    <VehicleCard vehicle={item} onRefuel={() => handleVehiclePress(item)} />
  );

  const renderFooter = () => {
    if (!hasNextPage) return null;

    return (
      <View className="py-4">
        {isFetching ? (
          <LoadingSpinner size="small" text="Carregando mais veículos..." />
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
            Nenhum resultado encontrado
          </Text>
          <Text
            className="text-gray-600 text-center 
            mb-8 text-base leading-6 max-w-sm"
            numberOfLines={3}
            ellipsizeMode="tail"
          >
            Não encontramos veículos com{" "}
            <Text className="font-semibold">
              &quot;
              {debouncedSearch.length > 15
                ? debouncedSearch.substring(0, 15) + "..."
                : debouncedSearch}
              &quot;
            </Text>
            . Tente buscar por placa, modelo ou marca.
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
            className="w-32 h-32 bg-gradient-to-br 
            from-primary-100 to-primary-200 
            rounded-3xl items-center justify-center shadow-lg"
          >
            <Text className="text-6xl">🚗</Text>
          </View>
          {/* Floating elements */}
          <View
            className="absolute -top-2 -right-2 w-8 h-8 
            bg-primary-500 rounded-full items-center justify-center"
          >
            <Text className="text-white text-xs font-bold">+</Text>
          </View>
          <View
            className="absolute -bottom-2 -left-2 
            w-6 h-6 bg-gray-300 rounded-full"
          />
        </View>

        <Text className="text-2xl font-bold text-gray-900 mb-3 text-center">
          Sua frota aguarda! 🚀
        </Text>
        <Text
          className="text-gray-600 text-center 
          mb-8 text-base leading-6 max-w-sm"
        >
          Ainda não há veículos cadastrados. Que tal começar a construir sua
          frota?
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
          <TouchableOpacity
            className="py-3"
            onPress={openWebPlatform}
            disabled={refreshing}
          >
            <Text
              className={`text-center font-medium ${
                refreshing ? "text-gray-400" : "text-primary-600"
              }`}
            >
              🚚 Cadastre novos veículos na plataforma web!
            </Text>
          </TouchableOpacity>
        </View>

        {/* Decorative dots */}
        <View className="flex-row items-center mt-8 space-x-2">
          <View className="w-2 h-2 bg-primary-200 rounded-full" />
          <View className="w-3 h-3 bg-primary-400 rounded-full" />
          <View className="w-2 h-2 bg-primary-200 rounded-full" />
        </View>
      </View>
    );
  };

  // Handle MASTER user without business selection
  if (user?.role === "MASTER" && !user?.businessId) {
    return (
      <SafeAreaView
        className="flex-1 bg-gradient-to-br 
        from-primary-50 to-white"
      >
        <View className="flex-1 justify-center items-center px-8">
          {/* Header illustration */}
          <View className="relative mb-8">
            <View
              className="w-32 h-32 bg-gradient-to-br from-primary-500 
              to-primary-600 rounded-3xl items-center justify-center shadow-xl"
            >
              <Text className="text-6xl">🏢</Text>
            </View>
            <View
              className="absolute -top-2 -right-2 w-8 h-8 bg-yellow-400 
              rounded-full items-center justify-center"
            >
              <Text className="text-white text-xs font-bold">👑</Text>
            </View>
          </View>

          <Text
            className="text-3xl font-bold 
            text-gray-900 mb-3 text-center"
          >
            Olá, Master! 👋
          </Text>
          <Text
            className="text-gray-600 text-center 
            mb-8 text-base leading-6 max-w-sm"
          >
            Para começar a gerenciar a frota, você precisa primeiro selecionar
            uma empresa.
          </Text>

          {/* Action buttons */}
          <View className="w-full max-w-sm">
            <Button
              onPress={() => router.push("/select-business")}
              className="mb-4 shadow-lg"
            >
              🏢 Selecionar Empresa
            </Button>
            <TouchableOpacity
              onPress={async () => {
                await logout();
                router.replace("/login");
              }}
              className="py-3"
            >
              <Text className="text-gray-500 text-center font-medium">
                ← Sair da conta
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
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
          <View className="mt-6 mb-2">
            <Input
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Buscar veículo por placa, modelo..."
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
                  : `${vehicles.length} resultado${
                      vehicles.length !== 1 ? "s" : ""
                    } para "${
                      debouncedSearch.length > 20
                        ? debouncedSearch.substring(0, 20) + "..."
                        : debouncedSearch
                    }"`}
              </Text>
            )}
          </View>

          {/* Stats Cards */}
          <View className="flex-row justify-between mt-4 -mb-4">
            <View className="bg-red-50 rounded-2xl p-4 flex-1 mr-2">
              <Text className=" text-xs font-medium mb-1">Total</Text>
              <Text className=" text-xl font-bold">{total || 0}</Text>
              <Text className=" text-xs">veículos</Text>
            </View>
            <View className="bg-red-50 rounded-2xl p-4 flex-1 ml-2">
              <Text className=" text-xs font-medium mb-1">Status</Text>
              <Text className=" text-xl font-bold">
                {activeVehiclesCount}{" "}
                <Text className="animate-pulse text-green-400 text-sm">●</Text>
              </Text>
              <Text className=" text-xs">ativos</Text>
            </View>
          </View>
        </View>

        {/* Error State */}
        {isError && (
          <View
            className="mx-6 mt-4 bg-white rounded-2xl 
            border border-danger-100 shadow-sm overflow-hidden"
          >
            <View
              className="bg-gradient-to-r 
              from-danger-500 to-danger-600 
              px-4 py-3"
            >
              <View className="flex-row items-center">
                <View
                  className="w-8 h-8 bg-white/20 
                  rounded-full items-center justify-center mr-3"
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
                  "Não foi possível carregar os veículos. Verifique sua conexão e tente novamente."}
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

        {/* Vehicle List */}
        {isLoading ? (
          <View className="px-4 pt-6">
            <VehicleSkeletonList count={6} />
          </View>
        ) : (
          <FlatList
            data={vehicles}
            renderItem={renderVehicleItem}
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
