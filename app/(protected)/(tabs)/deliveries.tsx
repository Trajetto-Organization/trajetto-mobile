import { useState } from "react";
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../../components/protected-route";
import { StatusBanners } from "../../../components/status-banners";

import { Button, ConfirmModal, LoadingSpinner } from "../../../components/ui";
import { DeliveryCard } from "../../../components/screens/deliveries";

import { useDeliveriesAccess } from "@/features/deliveries/hooks/use-deliveries-access";
import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";

import { useDeliveryActions } from "@/features/deliveries/hooks/use-delivery-actions";
import {
  activeRoute,
  canStartRoute,
  stopPosition,
} from "@/features/deliveries/delivery-rules";

import { refreshWithConnectionFeedback } from "@/utils/pull-to-refresh";
import { ApiError } from "@/utils/api";

import type { DriverDelivery } from "@/features/deliveries/types";

interface ListRow {
  key: string;
  header?: string;
  delivery?: DriverDelivery;

  /** Position in the dispatcher's order, when this delivery is on a route. */
  position?: number | null;
}

/** Section headers and cards flattened into one list for the FlatList. */
const buildRows = (
  inRoute: DriverDelivery[],
  designated: DriverDelivery[],
): ListRow[] => {
  const rows: ListRow[] = [];

  if (inRoute.length > 0) {
    rows.push({ key: "header-in-route", header: `Em rota (${inRoute.length})` });

    // The position is numbered WITHIN its group, because that is the list the
    // driver is looking at: a route half worked would otherwise start at 4.
    rows.push(
      ...inRoute.map((d) => ({
        key: d.id,
        delivery: d,
        position: stopPosition(inRoute, d),
      })),
    );
  }

  if (designated.length > 0) {
    rows.push({
      key: "header-designated",
      header: `Designadas (${designated.length})`,
    });

    rows.push(
      ...designated.map((d) => ({
        key: d.id,
        delivery: d,
        position: stopPosition(designated, d),
      })),
    );
  }

  return rows;
};

const DeliveriesScreen = () => {
  const router = useRouter();

  const hasAccess = useDeliveriesAccess();

  const {
    businessId,
    designated,
    inRoute,
    isLoading,
    isError,
    error,
    moduleDisabled,
    refetch,
  } = useMyDeliveries();

  // The API refusing on the merits (permission, driver-only) says exactly
  // why in Portuguese — showing it beats a generic "check your connection"
  // that sends the user hunting for a network problem that does not exist.
  const rejectionMessage =
    error instanceof ApiError && !error.isTransient ? error.message : null;

  /**
   * Which route this day belongs to, read off the deliveries themselves —
   * there is no second request for it, and a phone with no signal could not
   * make one anyway.
   *
   * Computed here rather than further down because the departure acts on it:
   * `startRoute` posts to the ROUTE now, which is what moves it to
   * IN_PROGRESS and therefore what starts the GPS trail. Null is the work
   * assigned before assignments created routes, and for that the whole-day
   * departure is still the only thing that moves anything.
   */
  const route = activeRoute([...inRoute, ...designated]);

  const actions = useDeliveryActions(businessId, route?.id ?? null);

  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [isStartConfirmOpen, setIsStartConfirmOpen] = useState<boolean>(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshWithConnectionFeedback(refetch);
    } finally {
      setRefreshing(false);
    }
  };

  const handleStartRoute = async () => {
    // The modal stays open, spinning, until the send settles.
    await actions.startRoute();
    setIsStartConfirmOpen(false);
  };

  const rows = buildRows(inRoute, designated);
  const showModuleOff = moduleDisabled || !hasAccess;

  return (
    <ProtectedRoute>
      {/* Bottom edge left to the tab bar: it pads the gesture area itself,
      and padding it twice opens a gray gap above the pill. */}
      <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-gray-50">
        {/* Header — a root tab has no back arrow: the bar below is the way
        around. */}
        <View className="flex-row items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <View
            className="h-10 w-10 items-center justify-center rounded-full
            bg-violet-100"
          >
            <Ionicons name="cube-outline" size={20} color="#7c3aed" />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-semibold text-gray-900">
              Minhas Entregas
            </Text>

            {/* The dispatcher gave this day a shape. Saying which route the
            driver is on is what makes the numbered stops below mean
            something — without it they are just numbers. */}
            {route ? (
              <Text className="text-xs text-gray-500" numberOfLines={1}>
                {route.name
                  ? `${route.name} · rota ${route.code}`
                  : `Rota ${route.code}`}
              </Text>
            ) : null}
          </View>
        </View>

        <StatusBanners />

        {showModuleOff ? (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="cube-outline" size={44} color="#9ca3af" />
            <Text className="mt-3 text-center text-base font-medium text-gray-700">
              O módulo de Entregas não está disponível
            </Text>
            <Text className="mt-1 text-center text-sm text-gray-500">
              {moduleDisabled
                ? "Ele foi desabilitado para a sua empresa. O que você registrou fica guardado no aparelho e será enviado quando o módulo voltar."
                : "Fale com o gestor da sua empresa para habilitar o acesso."}
            </Text>
          </View>
        ) : isLoading ? (
          <LoadingSpinner text="Carregando as entregas do dia..." />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.key}
            contentContainerClassName="px-4 py-4 pb-36"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
            renderItem={({ item }) =>
              item.header ? (
                <Text className="mb-2 mt-2 text-sm font-semibold text-gray-700">
                  {item.header}
                </Text>
              ) : (
                <DeliveryCard
                  delivery={item.delivery!}
                  position={item.position}
                  // navigate (not push): a double-tap must not stack
                  // two copies of the detail screen.
                  onPress={() =>
                    router.navigate({
                      pathname: "/delivery-detail",
                      params: { id: item.delivery!.id },
                    })
                  }
                />
              )
            }
            ListEmptyComponent={
              <View className="items-center px-8 pt-16">
                <Ionicons name="checkmark-done-outline" size={44} color="#9ca3af" />
                <Text className="mt-3 text-center text-base font-medium text-gray-700">
                  {isError
                    ? "Não foi possível carregar as entregas"
                    : "Nenhuma entrega para hoje"}
                </Text>
                <Text className="mt-1 text-center text-sm text-gray-500">
                  {isError
                    ? (rejectionMessage ??
                      "Verifique a conexão e puxe para atualizar.")
                    : "Quando o despachante designar entregas para você, elas aparecem aqui."}
                </Text>
              </View>
            }
          />
        )}

        {/* Start route: one tap moves the whole designated block */}
        {!showModuleOff && canStartRoute(designated) && (
          <View
            className="absolute bottom-0 left-0 right-0 border-t
            border-gray-200 bg-white px-4 pt-3"
            // The glass tab bar sits below this screen's area and already
            // absorbs the system inset — a fixed padding is all that's left.
            style={{ paddingBottom: 12 }}
          >
            <Button
              onPress={() => setIsStartConfirmOpen(true)}
              loading={actions.isSubmitting}
              disabled={actions.isSubmitting}
              fullWidth
            >
              {`Iniciar rota (${designated.length} entrega${designated.length > 1 ? "s" : ""})`}
            </Button>
          </View>
        )}

        <ConfirmModal
          visible={isStartConfirmOpen}
          emoji="🚚"
          isLoading={actions.isSubmitting}
          title="Iniciar a rota?"
          message={`${designated.length} entrega${designated.length > 1 ? "s designadas passam" : " designada passa"} para Em rota. O gestor acompanha a partir daí.`}
          confirmText="Iniciar rota"
          cancelText="Ainda não"
          onConfirm={handleStartRoute}
          onCancel={() => setIsStartConfirmOpen(false)}
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default DeliveriesScreen;
