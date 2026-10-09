import { useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../../components/protected-route";
import { StatusBanners } from "../../../components/status-banners";

import { Button, ConfirmModal, LoadingSpinner } from "../../../components/ui";
import { DeliveryCard } from "../../../components/screens/deliveries";
import { RouteChatShortcut } from "../../../components/screens/chat/route-chat-shortcut";

import { refreshAllLinkedChatMessages } from "@/features/chat/linked-messages";
import { useDeliveriesAccess } from "@/features/deliveries/hooks/use-deliveries-access";
import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";

import { useDeliveryActions } from "@/features/deliveries/hooks/use-delivery-actions";
import { useOnTheWay } from "@/features/deliveries/hooks/use-on-the-way";
import {
  deliverySections,
  headerRoute,
  routeLabel,
  routePlan,
  sectionTitle,
  startRouteLabel,
  stopPosition,
  type DeliverySection,
  type StartRouteTarget,
} from "@/features/deliveries/delivery-rules";

import { useLocationWarning } from "@/features/tracking/use-location-warning";
import { useDriverPause } from "@/features/pauses/use-driver-pause";
import { isPauseAllowed } from "@/features/pauses/pause-rules";
import {
  PauseBanner,
  PauseHeaderAction,
} from "../../../components/screens/pauses/pause-control";

import { refreshWithConnectionFeedback } from "@/utils/pull-to-refresh";
import { useThemeColors } from "@/hooks/use-theme";
import { ApiError } from "@/utils/api";

import type { DriverDelivery } from "@/features/deliveries/types";

type ListRow =
  | { key: string; type: "header"; section: DeliverySection<DriverDelivery> }
  | {
      key: string;
      type: "delivery";
      delivery: DriverDelivery;

      /** Position in the dispatcher's order, when this delivery is on a route. */
      position: number | null;
    };

/**
 * Sections flattened into one list for the FlatList: a header per route —
 * with its own "Iniciar rota" when pressing it moves something — and its
 * deliveries below it.
 */
const buildRows = (sections: DeliverySection<DriverDelivery>[]): ListRow[] =>
  sections.flatMap((section) => [
    { key: `header:${section.key}`, type: "header" as const, section },

    // The position is numbered WITHIN its route, because that is the list the
    // driver is looking at: a route half worked would otherwise start at 4.
    ...section.deliveries.map((delivery) => ({
      key: delivery.id,
      type: "delivery" as const,
      delivery,
      position: stopPosition(section.deliveries, delivery),
    })),
  ]);

const confirmMessage = (target: StartRouteTarget): string => {
  const moves =
    target.count > 1
      ? `${target.count} entregas designadas passam`
      : "1 entrega designada passa";

  const which =
    target.routeCode !== null ? ` da rota ${target.routeCode}` : " sem rota";

  return `${moves}${which} para Em rota. O gestor acompanha a partir daí.`;
};

const DeliveriesScreen = () => {
  const router = useRouter();
  const colors = useThemeColors();

  const hasAccess = useDeliveriesAccess();

  const {
    businessId,
    deliveries,
    designated,
    inRoute,
    occurrenceTypes,
    pauseTypes,
    journey,
    isLoading,
    isError,
    error,
    moduleDisabled,
    refetch,
  } = useMyDeliveries();

  const location = useLocationWarning();

  // The driver's pause (decision 6.1): offline-first, survives the app dying.
  const pause = useDriverPause();

  // Decision 14.4: a pause starts only inside a journey (the cached day).
  const pauseAllowed = isPauseAllowed({ data: deliveries, journey });

  // The API refusing on the merits (permission, driver-only) says exactly
  // why in Portuguese — showing it beats a generic "check your connection"
  // that sends the user hunting for a network problem that does not exist.
  const rejectionMessage =
    error instanceof ApiError && !error.isTransient ? error.message : null;

  /**
   * One section per route, read off the deliveries themselves — there is no
   * second request for it, and a phone with no signal could not make one.
   *
   * Each designated section carries its own departure: a driver already on
   * the street can be handed a second route, and the single button that
   * read "the" route off the first delivery started the one already running
   * (MOB-04).
   */
  const sections = useMemo(
    () => deliverySections(inRoute, designated),
    [inRoute, designated],
  );

  const route = headerRoute(sections);

  const actions = useDeliveryActions(businessId);

  // Which stop the driver told the base they are heading to (decision 6.4),
  // on the card as on the delivery screen.
  const onTheWay = useOnTheWay(businessId);

  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [startTarget, setStartTarget] = useState<StartRouteTarget | null>(null);

  const handleRefresh = async () => {
    setRefreshing(true);

    // The route sections' "Conversas sobre esta rota" previews ride on the
    // same gesture; they do not hold the spinner.
    refreshAllLinkedChatMessages();

    try {
      await refreshWithConnectionFeedback(refetch);
    } finally {
      setRefreshing(false);
    }
  };

  const handleStartRoute = async () => {
    if (!startTarget) return;

    // The modal stays open, spinning, until the send settles.
    await actions.startRoute(startTarget);
    setStartTarget(null);
  };

  const rows = buildRows(sections);
  const showModuleOff = moduleDisabled || !hasAccess;

  const renderHeader = (section: DeliverySection<DriverDelivery>) => {
    const start = section.start;
    const plan = section.route ? routePlan(section.route) : null;

    return (
      <View className="mb-2 mt-2">
        <Text className="text-sm font-semibold text-ink-soft" numberOfLines={2}>
          {sectionTitle(section)}
        </Text>

        {plan ? (
          <Text className="mt-0.5 text-xs text-muted" numberOfLines={2}>
            {plan}
          </Text>
        ) : null}

        {/* A message about the whole route (decision 6.7). */}
        {section.route ? <RouteChatShortcut route={section.route} /> : null}

        {start ? (
          <View className="mt-2">
            <Button
              onPress={() => setStartTarget(start)}
              testID="start-route-button"
              disabled={actions.isSubmitting}
              fullWidth
            >
              {startRouteLabel(start)}
            </Button>
          </View>
        ) : null}

        {section.notice ? (
          <Text className="mt-1 text-xs text-muted">{section.notice}</Text>
        ) : null}
      </View>
    );
  };

  return (
    <ProtectedRoute>
      {/* Bottom edge left to the tab bar: it pads the gesture area itself,
      and padding it twice opens a gray gap above the pill. */}
      <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-background">
        {/* Header — a root tab has no back arrow: the bar below is the way
        around. */}
        <View className="flex-row items-center gap-3 border-b border-border bg-surface px-4 py-3">
          <View
            className="h-10 w-10 items-center justify-center rounded-full
            bg-deliveries-soft"
          >
            <Ionicons name="cube-outline" size={20} color={colors.deliveries} />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-semibold text-ink">
              Minhas Entregas
            </Text>

            {/* The dispatcher gave this day a shape. Saying which route the
            driver is on is what makes the numbered stops below mean
            something — with more than one, each section says its own. */}
            {route ? (
              <Text className="text-xs text-muted" numberOfLines={1}>
                {routeLabel(route)}
              </Text>
            ) : null}
          </View>

          {!showModuleOff ? (
            <PauseHeaderAction
              pause={pause}
              allowed={pauseAllowed}
              pauseTypes={pauseTypes}
            />
          ) : null}
        </View>

        <StatusBanners />

        {!showModuleOff ? <PauseBanner pause={pause} /> : null}

        {!showModuleOff && location.warning ? (
          <TouchableOpacity
            onPress={() => void location.resolve()}
            accessibilityRole="button"
            accessibilityLabel={location.warning.actionLabel}
            className="flex-row items-center gap-3 border-b border-warning/40
            bg-warning-soft px-4 py-3"
          >
            <Ionicons name="location-outline" size={20} color={colors.warning} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-warning">
                {location.warning.title}
              </Text>
              <Text className="text-xs text-ink-soft">
                {location.warning.message}
              </Text>
            </View>
            <Text className="text-xs font-semibold text-warning">
              {location.warning.actionLabel}
            </Text>
          </TouchableOpacity>
        ) : null}

        {showModuleOff ? (
          <View className="flex-1 items-center justify-center px-8">
            <Ionicons name="cube-outline" size={44} color={colors.muted} />
            <Text className="mt-3 text-center text-base font-medium text-ink-soft">
              O módulo de Entregas não está disponível
            </Text>
            <Text className="mt-1 text-center text-sm text-muted">
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
            testID="deliveries-list"
            keyExtractor={(row) => row.key}
            contentContainerClassName="px-4 py-4 pb-36"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                // Android draws its own white disc otherwise, a glare in dark.
                colors={[colors.primary]}
                progressBackgroundColor={colors.card}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item }) =>
              item.type === "header" ? (
                renderHeader(item.section)
              ) : (
                <DeliveryCard
                  delivery={item.delivery}
                  position={item.position}
                  onTheWay={onTheWay.viewFor(item.delivery, deliveries, occurrenceTypes)}
                  // navigate (not push): a double-tap must not stack
                  // two copies of the detail screen.
                  onPress={() =>
                    router.navigate({
                      pathname: "/delivery-detail",
                      params: { id: item.delivery.id },
                    })
                  }
                />
              )
            }
            ListEmptyComponent={
              <View className="items-center px-8 pt-16">
                <Ionicons name="checkmark-done-outline" size={44} color={colors.muted} />
                <Text className="mt-3 text-center text-base font-medium text-ink-soft">
                  {isError
                    ? "Não foi possível carregar as entregas"
                    : "Nenhuma entrega para hoje"}
                </Text>
                <Text className="mt-1 text-center text-sm text-muted">
                  {isError
                    ? (rejectionMessage ??
                      "Verifique a conexão e puxe para atualizar.")
                    : "Quando o despachante designar entregas para você, elas aparecem aqui."}
                </Text>
              </View>
            }
          />
        )}

        <ConfirmModal
          visible={startTarget !== null}
          testID="start-route-modal"
          emoji="🚚"
          isLoading={actions.isSubmitting}
          title={
            startTarget?.routeCode != null
              ? `Iniciar a rota ${startTarget.routeCode}?`
              : "Iniciar a rota?"
          }
          message={startTarget ? confirmMessage(startTarget) : ""}
          confirmText="Iniciar rota"
          cancelText="Ainda não"
          onConfirm={handleStartRoute}
          onCancel={() => setStartTarget(null)}
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default DeliveriesScreen;
