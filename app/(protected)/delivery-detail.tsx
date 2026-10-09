import { useMemo, useState } from "react";
import { Linking, ScrollView, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../components/protected-route";
import { StatusBanners } from "../../components/status-banners";

import { Button, ConfirmModal } from "../../components/ui";

import { useOutboxStore } from "@/store/outbox-store";
import { useThemeColors } from "@/hooks/use-theme";

import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";
import {
  DELIVERED_PENDING_LABEL,
  deliveredRequestPending,
} from "@/features/deliveries/delivered-requirements";
import { useDeliveryActions } from "@/features/deliveries/hooks/use-delivery-actions";
import { useOnTheWay } from "@/features/deliveries/hooks/use-on-the-way";
import { OnTheWayAction } from "../../components/screens/deliveries/on-the-way-action";

import {
  DRIVER_DELIVERY_STATUS_LABELS,
  arrivalLabel,
  arrivalState,
  deliveryActions as availableActions,
  formatDeliveryAddress,
  googleMapsUrl,
  queuedArrivalAt,
  wazeUrl,
} from "@/features/deliveries/delivery-rules";

import { useLocationWarning } from "@/features/tracking/use-location-warning";

import {
  chatContextOfDelivery,
  chatContextParams,
} from "@/features/chat/chat-context";

import { useProofFeedback } from "@/features/notifications/use-proof-feedback";
import { telephoneLink } from "@/features/deliveries/telephone-link";
import { DeliveryChatHistory } from "../../components/screens/chat/delivery-chat-history";
import { ProofFeedbackCard } from "../../components/screens/deliveries/proof-feedback-card";
import { OccurrenceAuthorizationCard } from "../../components/screens/occurrences/occurrence-authorization-card";

// Same pairs as the list's card: designated is neutral (pink and violet
// identify modules, not states), in route is the primary tint.
const STATUS_CHIP: Record<string, { box: string; text: string }> = {
  PENDING: { box: "border border-border bg-subtle", text: "text-ink-soft" },
  IN_TRANSIT: { box: "bg-primary-soft", text: "text-primary" },
};

const DEFAULT_CHIP = { box: "border border-border bg-subtle", text: "text-ink-soft" };

const DeliveryDetailScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  const { id } = useLocalSearchParams<{ id: string }>();

  const { businessId, deliveries, occurrenceTypes, deliveredTypes } = useMyDeliveries();
  const actions = useDeliveryActions(businessId);
  const onTheWay = useOnTheWay(businessId);

  const [isArriveConfirmOpen, setIsArriveConfirmOpen] = useState<boolean>(false);

  const delivery = useMemo(
    () => deliveries.find((entry) => entry.id === id) ?? null,
    [deliveries, id],
  );

  // An arrival still in the queue counts as said: offline, the stop's status
  // only changes when the queue reaches the API (MOB-19).
  const outboxItems = useOutboxStore((state) => state.items);
  const queuedArrival = id ? queuedArrivalAt(outboxItems, id) : null;

  const location = useLocationWarning();

  // The automatic reading's warning about this delivery's proof (decision
  // 6.9), kept on the phone: the proven delivery has left the list, and the
  // push that brought it is gone from the tray once tapped.
  const proof = useProofFeedback(id ?? "", delivery);

  // The delivery left the working list — proven, failed or cancelled while
  // this screen was open. The list is the source of truth; go back to it.
  if (!delivery) {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
          <Ionicons name="checkmark-done-outline" size={44} color={colors.muted} />
          <Text className="mt-3 text-center text-base font-medium text-ink-soft">
            Esta entrega saiu da sua lista
          </Text>
          <Text className="mb-4 mt-1 text-center text-sm text-muted">
            Ela foi concluída ou saiu da rota. A lista do dia está atualizada.
          </Text>
          {proof ? (
            <View className="mb-4 w-full">
              <ProofFeedbackCard proof={proof} />
            </View>
          ) : null}
          {/* A plain "Voltar": a proof warning opens this screen from the
          notifications inbox too, and back goes there, not to the list. */}
          <Button onPress={() => router.back()}>Voltar</Button>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  const allowed = availableActions(delivery.status);
  const chip = STATUS_CHIP[delivery.status] ?? DEFAULT_CHIP;

  const arrival = arrivalState(delivery, queuedArrival);
  const recipientTelephoneLink = telephoneLink(delivery.recipient_telephone);

  // "Estou a caminho" (decision 6.4): offered on a running route's pending
  // stop, then shown as the state while this is the stop being headed to.
  const onTheWayState = onTheWay.viewFor(delivery, deliveries, occurrenceTypes);

  const handleArrival = async () => {
    // The modal stays open, spinning, until the send settles — closing it
    // first left the driver staring at a silent screen.
    await actions.registerArrival(delivery.id, delivery.recipient_name);
    setIsArriveConfirmOpen(false);
  };

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-background">
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-border bg-surface px-4 py-3">
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-lg font-semibold text-ink" numberOfLines={1}>
              {delivery.recipient_name}
            </Text>
            {delivery.code ? (
              <Text className="text-xs text-muted">Pedido: {delivery.code}</Text>
            ) : null}
          </View>
          <View className={`rounded-full px-3 py-1 ${chip.box}`}>
            <Text className={`text-xs font-medium ${chip.text}`}>
              {DRIVER_DELIVERY_STATUS_LABELS[delivery.status]}
            </Text>
          </View>
        </View>

        <StatusBanners />

        {location.warning ? (
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

        {/* Room for the whole action bar, "Estou a caminho" row included. */}
        <ScrollView className="flex-1 px-4 py-4" contentContainerClassName="pb-56">
          {/* The reading's warning first: it may ask for a new photo. */}
          {proof ? (
            <View className="mb-3">
              <ProofFeedbackCard
                proof={proof}
                onRetake={
                  allowed.canProve
                    ? () =>
                        router.navigate({
                          pathname: "/delivery-proof",
                          params: { id: delivery.id },
                        })
                    : undefined
                }
              />
            </View>
          ) : null}

          {/* The tower's authorization of a reported occurrence (decision
          6.3): waiting, or its answer and what to do next. */}
          <OccurrenceAuthorizationCard
            delivery={delivery}
            occurrenceTypes={occurrenceTypes}
            className="mb-3"
          />

          {/* Address + navigation */}
          <View className="rounded-xl border border-border bg-card p-4">
            <Text className="mb-1 text-sm font-semibold text-ink">
              Endereço de entrega
            </Text>
            <Text className="text-sm text-muted">
              {formatDeliveryAddress(delivery)}
            </Text>
            {delivery.complement ? (
              <Text className="text-sm text-muted">{delivery.complement}</Text>
            ) : null}
            {delivery.cep ? (
              <Text className="text-xs text-muted">CEP: {delivery.cep}</Text>
            ) : null}

            <View className="mt-3 flex-row gap-3">
              <TouchableOpacity
                onPress={() => Linking.openURL(googleMapsUrl(delivery))}
                accessibilityRole="button"
                className="flex-1 flex-row items-center justify-center gap-1
                rounded-lg border border-input bg-card py-2"
              >
                <Ionicons name="map-outline" size={16} color={colors.inkSoft} />
                <Text className="text-sm font-medium text-ink-soft">Maps</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => Linking.openURL(wazeUrl(delivery))}
                accessibilityRole="button"
                className="flex-1 flex-row items-center justify-center gap-1
                rounded-lg border border-input bg-card py-2"
              >
                <Ionicons name="navigate-outline" size={16} color={colors.inkSoft} />
                <Text className="text-sm font-medium text-ink-soft">Waze</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Recipient contact */}
          {recipientTelephoneLink ? (
            <TouchableOpacity
              onPress={() =>
                void Linking.openURL(recipientTelephoneLink).catch(
                  () => undefined,
                )
              }
              accessibilityRole="button"
              className="mt-3 flex-row items-center justify-between
              rounded-xl border border-border bg-card p-4"
            >
              <View>
                <Text className="text-sm font-semibold text-ink">
                  Ligar para o destinatário
                </Text>
                <Text className="text-sm text-muted">
                  {delivery.recipient_telephone}
                </Text>
              </View>
              <Ionicons name="call-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          ) : null}

          {/* Chat shortcut: opens the conversation with this delivery (and
          its route) as the messages' context chip (decision 6.7). */}
          <TouchableOpacity
            onPress={() =>
              router.navigate({
                pathname: "/chat",
                params: chatContextParams(chatContextOfDelivery(delivery)),
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Falar com a base sobre esta entrega"
            className="mt-3 flex-row items-center justify-between
            rounded-xl border border-border bg-card p-4"
          >
            <View>
              <Text className="text-sm font-semibold text-ink">
                Falar com a base
              </Text>
              <Text className="text-sm text-muted">
                A mensagem já vai ligada a esta entrega
              </Text>
            </View>
            <Ionicons name="chatbubbles-outline" size={20} color={colors.primary} />
          </TouchableOpacity>

          {/* What was said about this delivery (decision 6.7). */}
          <DeliveryChatHistory delivery={delivery} />

          {/* Cargo */}
          <View className="mt-3 rounded-xl border border-border bg-card p-4">
            <Text className="mb-2 text-sm font-semibold text-ink">
              Carga{delivery.invoice_number ? ` · NF-e ${delivery.invoice_number}` : ""}
            </Text>

            {delivery.items && delivery.items.length > 0 ? (
              delivery.items.map((item) => (
                <View
                  key={item.id}
                  className="flex-row items-center justify-between border-b
                  border-border py-1.5 last:border-b-0"
                >
                  <Text className="mr-2 flex-1 text-sm text-ink-soft" numberOfLines={1}>
                    {item.description}
                  </Text>
                  <Text className="text-xs text-muted">
                    x{String(item.quantity)}
                  </Text>
                </View>
              ))
            ) : (
              <Text className="text-sm text-muted">
                Entrega registrada sem itens.
              </Text>
            )}

            <Text className="mt-2 text-xs text-muted">
              Embarcador: {delivery.shipper?.name ?? "—"}
            </Text>
          </View>

          {/* Notes */}
          {delivery.notes ? (
            <View className="mt-3 rounded-xl border border-warning/40 bg-warning-soft p-4">
              <Text className="mb-1 text-sm font-semibold text-warning">
                Observações
              </Text>
              <Text className="text-sm text-ink-soft">{delivery.notes}</Text>
            </View>
          ) : null}

          {delivery.status === "PENDING" ? (
            <View className="mt-3 rounded-xl border border-border bg-subtle p-4">
              <Text className="text-sm text-ink-soft">
                Esta entrega está designada para você. Inicie a rota na lista
                do dia para registrar chegada, comprovação e ocorrências.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Actions: everything operational happens in route */}
        {(allowed.canArrive || allowed.canProve || allowed.canReportOccurrence) && (
          <View
            className="absolute bottom-0 left-0 right-0 border-t
            border-border bg-surface px-4 pt-3"
            // Absolutely positioned, so the SafeAreaView padding never
            // reaches it: the system navigation bar inset goes in by hand
            // or the buttons slide under the phone's bottom bar.
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <OnTheWayAction
              view={onTheWayState}
              isSubmitting={onTheWay.isSubmitting}
              onPress={() => void onTheWay.mark(delivery)}
            />

            <View className="flex-row gap-3">
              <View className="flex-1">
                {arrival.arrived ? (
                  // Said once per visit: a second tap wrote a second ARRIVAL
                  // for the same stop (MOB-19).
                  <View
                    accessibilityRole="text"
                    accessibilityState={{ disabled: true }}
                    className="flex-1 flex-row items-center justify-center gap-1
                    rounded-lg border border-success/40 bg-success-soft px-2 py-2"
                  >
                    <Ionicons
                      name={arrival.queued ? "time-outline" : "checkmark-circle-outline"}
                      size={16}
                      color={colors.success}
                    />
                    <Text
                      className="flex-shrink text-center text-xs font-medium text-success"
                      numberOfLines={2}
                    >
                      {arrivalLabel(arrival)}
                    </Text>
                  </View>
                ) : (
                  <Button
                    variant="outline"
                    onPress={() => setIsArriveConfirmOpen(true)}
                    testID="delivery-arrive-button"
                    disabled={actions.isSubmitting}
                    fullWidth
                  >
                    Cheguei
                  </Button>
                )}
              </View>
              <View className="flex-1">
                <Button
                  // Routed screen, not a modal: the photo sheet and toasts
                  // live in the root portal a native Modal would cover.
                  testID="delivery-deliver-button"
                  onPress={() =>
                    router.navigate({
                      pathname: "/delivery-proof",
                      params: { id: delivery.id },
                    })
                  }
                  // Decision 14.3: a delivery request of this driver waiting for
                  // the tower holds "Entregar"; "Ocorrência" stays available.
                  disabled={
                    actions.isSubmitting ||
                    deliveredRequestPending(delivery, deliveredTypes)
                  }
                  fullWidth
                >
                  {deliveredRequestPending(delivery, deliveredTypes)
                    ? DELIVERED_PENDING_LABEL
                    : "Entregar"}
                </Button>
              </View>
            </View>

            <TouchableOpacity
              onPress={() =>
                router.navigate({
                  pathname: "/delivery-occurrence",
                  params: { id: delivery.id },
                })
              }
              disabled={actions.isSubmitting}
              testID="delivery-occurrence-button"
              accessibilityRole="button"
              className="mt-2 items-center py-2"
            >
              <Text className="text-sm font-medium text-destructive">
                Registrar ocorrência
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <ConfirmModal
          visible={isArriveConfirmOpen && !arrival.arrived}
          testID="arrival-modal"
          emoji="📍"
          title="Registrar chegada?"
          message="Sua localização atual será registrada como o ponto de chegada desta entrega."
          confirmText="Cheguei"
          cancelText="Cancelar"
          isLoading={actions.isSubmitting}
          onConfirm={handleArrival}
          onCancel={() => setIsArriveConfirmOpen(false)}
        />

      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default DeliveryDetailScreen;
