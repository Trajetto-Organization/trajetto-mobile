import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../../components/protected-route";
import { Header } from "../../../components/header";
import { StatusBanners } from "../../../components/status-banners";

import {
  Button,
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
import { useThemeColors } from "@/hooks/use-theme";
import { useBusinessModules } from "@/features/access/use-business-modules";
import {
  HOME_ACTION_LABEL,
  homeNotice,
  type HomeAction,
} from "@/features/access/app-surfaces";

const hasWebPlatform = Boolean(process.env.EXPO_PUBLIC_WEB_APPLICATION_URL);

interface AccessStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  children?: React.ReactNode;
}

/**
 * "Início" when it is not a vehicle list: says why, and what to do instead
 * (the wording is `homeNotice`, tested with the access rules).
 */
const AccessState = ({ icon, title, message, children }: AccessStateProps) => {
  const colors = useThemeColors();

  return (
    <View className="flex-1 items-center justify-center px-8 pb-16">
      <View className="mb-5 h-16 w-16 items-center justify-center rounded-full bg-primary-soft">
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>

      <Text className="mb-2 text-center text-xl font-bold text-ink">
        {title}
      </Text>
      <Text className="mb-8 text-center text-base leading-6 text-muted">
        {message}
      </Text>

      <View className="w-full max-w-sm gap-3">{children}</View>
    </View>
  );
};

const VehiclesScreen = () => {
  const {
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
  } = useVehicles();

  const businessModules = useBusinessModules();
  const colors = useThemeColors();

  const modals = (
    <>
      <LogoutModal
        visible={showLogoutModal}
        onClose={closeLogoutModal}
        onConfirm={confirmLogout}
        isLoading={isLoggingOut}
      />

      <SwitchBusinessModal
        visible={showSwitchBusinessModal}
        onClose={() => setShowSwitchBusinessModal(false)}
        onConfirm={confirmSwitchBusiness}
        currentBusiness={user?.selectedBusiness as string}
        isLoading={isSwitchingBusiness}
      />
    </>
  );

  if (home.kind === "select-business") {
    return (
      <>
        <MasterUserState
          onSelectBusiness={navigateToSelectBusiness}
          onLogout={handleMasterLogout}
        />
        {modals}
      </>
    );
  }

  // Every other state keeps the header: "Início" is the tab that carries the
  // account (bell, drawer, "Sair da conta") for every session, including a
  // deliveries-only driver, whose other tabs have none of it.
  if (home.kind !== "fleet") {
    const notice = homeNotice(home, user?.selectedBusiness as string | undefined);

    const runAction: Record<HomeAction, () => void> = {
      "open-deliveries": navigateToDeliveries,
      notifications: navigateToNotifications,
      "switch-business": handleSwitchBusiness,
      "web-panel": () => void openWebPlatform(),
    };

    // The web panel is only offered when the build knows where it is.
    const actions = (notice?.actions ?? []).filter(
      (action) => action !== "web-panel" || hasWebPlatform,
    );

    return (
      <ProtectedRoute>
        <SafeAreaView
          edges={["top", "left", "right"]}
          className="flex-1 bg-background"
        >
          <Header pageTitle="Início" onLogout={handleLogout} />
          <StatusBanners />

          {home.kind === "checking-modules" &&
            (businessModules.isError ? (
              <AccessState
                icon="cloud-offline-outline"
                title="Não foi possível verificar a empresa"
                message="Sem resposta do servidor sobre os módulos contratados por esta empresa. Verifique a conexão e tente de novo."
              >
                <Button onPress={businessModules.retry} fullWidth>
                  Tentar novamente
                </Button>
                <Button
                  variant="outline"
                  onPress={handleSwitchBusiness}
                  fullWidth
                >
                  Trocar de empresa
                </Button>
              </AccessState>
            ) : (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color={colors.primary} />
                <Text className="mt-4 text-sm text-muted">
                  Verificando os módulos da empresa…
                </Text>
              </View>
            ))}

          {notice && (
            <AccessState
              icon={notice.icon}
              title={notice.title}
              message={notice.message}
            >
              {actions.map((action, index) => (
                <Button
                  key={action}
                  variant={index === 0 ? "primary" : "outline"}
                  onPress={runAction[action]}
                  fullWidth
                >
                  {HOME_ACTION_LABEL[action]}
                </Button>
              ))}
            </AccessState>
          )}

          {modals}
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      {/* Bottom edge left to the tab bar: it pads the gesture area itself,
      and padding it twice opens a gray gap above the pill. */}
      <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-background">
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
              rounded-xl border border-primary/40 bg-primary-soft p-4"
            >
              <View className="flex-row items-center">
                <View
                  className="mr-3 h-10 w-10 items-center justify-center
                  rounded-full bg-card"
                >
                  <Ionicons name="business-outline" size={20} color={colors.primary} />
                </View>
                <View>
                  <Text className="text-base font-semibold text-ink">
                    Empresa selecionada
                  </Text>
                  <Text className="text-xs text-muted" numberOfLines={1}>
                    {(user?.selectedBusiness as string) ||
                      "Toque para escolher a empresa"}
                  </Text>
                </View>
              </View>
              <Ionicons name="swap-horizontal" size={20} color={colors.primary} />
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

        {modals}

        {/* Vehicle Action Modal — its options already require Gestão de
        Frota (checkFuelPermission / checkChecklistPermission). */}
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
