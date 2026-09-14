import { useMemo, useState } from "react";
import { Linking, ScrollView, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../components/protected-route";
import { StatusBanners } from "../../components/status-banners";

import { Button, ConfirmModal } from "../../components/ui";

import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";
import { useDeliveryActions } from "@/features/deliveries/hooks/use-delivery-actions";

import {
  DRIVER_DELIVERY_STATUS_LABELS,
  deliveryActions as availableActions,
  formatDeliveryAddress,
  googleMapsUrl,
  wazeUrl,
} from "@/features/deliveries/delivery-rules";

const STATUS_CHIP: Record<string, string> = {
  PENDING: "bg-violet-100 text-violet-800",
  IN_TRANSIT: "bg-blue-100 text-blue-800",
};

const DeliveryDetailScreen = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { id } = useLocalSearchParams<{ id: string }>();

  const { businessId, deliveries } = useMyDeliveries();
  const actions = useDeliveryActions(businessId);

  const [isArriveConfirmOpen, setIsArriveConfirmOpen] = useState<boolean>(false);

  const delivery = useMemo(
    () => deliveries.find((entry) => entry.id === id) ?? null,
    [deliveries, id],
  );

  // The delivery left the working list — proven, failed or cancelled while
  // this screen was open. The list is the source of truth; go back to it.
  if (!delivery) {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 items-center justify-center bg-gray-50 px-8">
          <Ionicons name="checkmark-done-outline" size={44} color="#9ca3af" />
          <Text className="mt-3 text-center text-base font-medium text-gray-700">
            Esta entrega saiu da sua lista
          </Text>
          <Text className="mb-4 mt-1 text-center text-sm text-gray-500">
            Ela foi concluída ou saiu da rota. A lista do dia está atualizada.
          </Text>
          <Button onPress={() => router.back()}>Voltar para a lista</Button>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  const allowed = availableActions(delivery.status);
  const chip = STATUS_CHIP[delivery.status] ?? "bg-slate-100 text-slate-800";

  const handleArrival = async () => {
    // The modal stays open, spinning, until the send settles — closing it
    // first left the driver staring at a silent screen.
    await actions.registerArrival(delivery.id, delivery.recipient_name);
    setIsArriveConfirmOpen(false);
  };

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-gray-50">
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-lg font-semibold text-gray-900" numberOfLines={1}>
              {delivery.recipient_name}
            </Text>
            {delivery.code ? (
              <Text className="text-xs text-gray-500">Pedido: {delivery.code}</Text>
            ) : null}
          </View>
          <View className={`rounded-full px-3 py-1 ${chip.split(" ")[0]}`}>
            <Text className={`text-xs font-medium ${chip.split(" ")[1]}`}>
              {DRIVER_DELIVERY_STATUS_LABELS[delivery.status]}
            </Text>
          </View>
        </View>

        <StatusBanners />

        <ScrollView className="flex-1 px-4 py-4" contentContainerClassName="pb-44">
          {/* Address + navigation */}
          <View className="rounded-xl border border-gray-200 bg-white p-4">
            <Text className="mb-1 text-sm font-semibold text-gray-900">
              Endereço de entrega
            </Text>
            <Text className="text-sm text-gray-600">
              {formatDeliveryAddress(delivery)}
            </Text>
            {delivery.complement ? (
              <Text className="text-sm text-gray-600">{delivery.complement}</Text>
            ) : null}
            {delivery.cep ? (
              <Text className="text-xs text-gray-500">CEP: {delivery.cep}</Text>
            ) : null}

            <View className="mt-3 flex-row gap-3">
              <TouchableOpacity
                onPress={() => Linking.openURL(googleMapsUrl(delivery))}
                accessibilityRole="button"
                className="flex-1 flex-row items-center justify-center gap-1
                rounded-lg border border-gray-300 py-2"
              >
                <Ionicons name="map-outline" size={16} color="#374151" />
                <Text className="text-sm font-medium text-gray-700">Maps</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => Linking.openURL(wazeUrl(delivery))}
                accessibilityRole="button"
                className="flex-1 flex-row items-center justify-center gap-1
                rounded-lg border border-gray-300 py-2"
              >
                <Ionicons name="navigate-outline" size={16} color="#374151" />
                <Text className="text-sm font-medium text-gray-700">Waze</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Recipient contact */}
          {delivery.recipient_telephone ? (
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(`tel:${delivery.recipient_telephone}`)
              }
              accessibilityRole="button"
              className="mt-3 flex-row items-center justify-between
              rounded-xl border border-gray-200 bg-white p-4"
            >
              <View>
                <Text className="text-sm font-semibold text-gray-900">
                  Ligar para o destinatário
                </Text>
                <Text className="text-sm text-gray-600">
                  {delivery.recipient_telephone}
                </Text>
              </View>
              <Ionicons name="call-outline" size={20} color="#2563eb" />
            </TouchableOpacity>
          ) : null}

          {/* Chat shortcut: opens the conversation with this delivery
          pre-linked as the message's context chip. */}
          <TouchableOpacity
            onPress={() =>
              router.navigate({
                pathname: "/chat",
                params: {
                  deliveryId: delivery.id,
                  recipient: delivery.recipient_name,
                },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Falar com a base sobre esta entrega"
            className="mt-3 flex-row items-center justify-between
            rounded-xl border border-gray-200 bg-white p-4"
          >
            <View>
              <Text className="text-sm font-semibold text-gray-900">
                Falar com a base
              </Text>
              <Text className="text-sm text-gray-600">
                A mensagem já vai ligada a esta entrega
              </Text>
            </View>
            <Ionicons name="chatbubbles-outline" size={20} color="#2563eb" />
          </TouchableOpacity>

          {/* Cargo */}
          <View className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
            <Text className="mb-2 text-sm font-semibold text-gray-900">
              Carga{delivery.invoice_number ? ` · NF-e ${delivery.invoice_number}` : ""}
            </Text>

            {delivery.items && delivery.items.length > 0 ? (
              delivery.items.map((item) => (
                <View
                  key={item.id}
                  className="flex-row items-center justify-between border-b
                  border-gray-100 py-1.5 last:border-b-0"
                >
                  <Text className="mr-2 flex-1 text-sm text-gray-700" numberOfLines={1}>
                    {item.description}
                  </Text>
                  <Text className="text-xs text-gray-500">
                    x{String(item.quantity)}
                  </Text>
                </View>
              ))
            ) : (
              <Text className="text-sm text-gray-500">
                Entrega registrada sem itens.
              </Text>
            )}

            <Text className="mt-2 text-xs text-gray-500">
              Embarcador: {delivery.shipper?.name ?? "—"}
            </Text>
          </View>

          {/* Notes */}
          {delivery.notes ? (
            <View className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <Text className="mb-1 text-sm font-semibold text-amber-800">
                Observações
              </Text>
              <Text className="text-sm text-amber-800">{delivery.notes}</Text>
            </View>
          ) : null}

          {delivery.status === "PENDING" ? (
            <View className="mt-3 rounded-xl bg-violet-50 p-4">
              <Text className="text-sm text-violet-800">
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
            border-gray-200 bg-white px-4 pt-3"
            // Absolutely positioned, so the SafeAreaView padding never
            // reaches it: the system navigation bar inset goes in by hand
            // or the buttons slide under the phone's bottom bar.
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button
                  variant="outline"
                  onPress={() => setIsArriveConfirmOpen(true)}
                  disabled={actions.isSubmitting}
                  fullWidth
                >
                  Cheguei
                </Button>
              </View>
              <View className="flex-1">
                <Button
                  // Routed screen, not a modal: the photo sheet and toasts
                  // live in the root portal a native Modal would cover.
                  onPress={() =>
                    router.navigate({
                      pathname: "/delivery-proof",
                      params: { id: delivery.id },
                    })
                  }
                  disabled={actions.isSubmitting}
                  fullWidth
                >
                  Entregar
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
              accessibilityRole="button"
              className="mt-2 items-center py-2"
            >
              <Text className="text-sm font-medium text-red-600">
                Registrar ocorrência
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <ConfirmModal
          visible={isArriveConfirmOpen}
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
