import { useState } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";
import Toast from "react-native-toast-message";

import { ProtectedRoute } from "../../components/protected-route";
import { StatusBanners } from "../../components/status-banners";
import { Button, ConfirmModal } from "../../components/ui";

import { useOutboxStore } from "@/store/outbox-store";
import {
  discardOutboxItem,
  processOutbox,
  retryOutboxItem,
  type OutboxItem,
} from "@/features/submissions/outbox";

const KIND_LABEL: Record<OutboxItem["kind"], string> = {
  checklist: "Checklist",
  fuel: "Abastecimento",
  "delivery-start-route": "Início de rota",
  "delivery-arrival": "Chegada da entrega",
  "delivery-proof": "Comprovação de entrega",
  "delivery-occurrence": "Ocorrência da entrega",
};

const formatCreatedAt = (isoDate: string): string => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/**
 * Everything the app is still holding on the driver's behalf.
 *
 * The queue works on its own, so this screen exists for the two moments it
 * cannot: when a submission was rejected for a reason only a person can fix,
 * and when the driver simply wants to confirm nothing was lost.
 */
const PendingSubmissionsScreen = () => {
  const router = useRouter();

  const items = useOutboxStore((state) => state.items);
  const activeItemId = useOutboxStore((state) => state.activeItemId);

  const activeProgress = useOutboxStore((state) => state.activeProgress);
  const isProcessing = useOutboxStore((state) => state.isProcessing);

  const [itemToDiscard, setItemToDiscard] = useState<OutboxItem | null>(null);

  const confirmDiscard = async () => {
    if (!itemToDiscard) return;

    const discarded = itemToDiscard;
    setItemToDiscard(null);

    await discardOutboxItem(discarded.id);

    Toast.show({
      type: "success",
      text1: "Envio descartado",
      text2: `O ${KIND_LABEL[discarded.kind].toLowerCase()} foi removido da fila.`,
      position: "top",
    });
  };

  const renderItem = ({ item }: { item: OutboxItem }) => {
    const isActive = item.id === activeItemId;
    const isFailed = item.status === "failed";

    return (
      <View className="mb-3 rounded-xl border border-gray-200 bg-white p-4">
        <View className="flex-row items-start gap-3">
          <View
            className={`h-9 w-9 items-center justify-center rounded-full ${
              isFailed ? "bg-danger-600/10" : "bg-primary-600/10"
            }`}
          >
            <Ionicons
              name={item.kind === "checklist" ? "clipboard-outline" : "water-outline"}
              size={18}
              color={isFailed ? "#dc2626" : "#2563eb"}
            />
          </View>

          <View className="flex-1">
            <Text className="text-base font-semibold text-gray-900">
              {KIND_LABEL[item.kind]}
            </Text>

            <Text className="text-xs text-gray-500">
              {item.vehicleLabel ? `${item.vehicleLabel} · ` : ""}
              {formatCreatedAt(item.createdAt)}
            </Text>

            {isActive && activeProgress ? (
              <Text className="mt-2 text-xs font-medium text-primary-600">
                Enviando… {activeProgress.uploaded} de {activeProgress.total}{" "}
                {activeProgress.total === 1 ? "foto" : "fotos"}
              </Text>
            ) : isFailed ? (
              <Text className="mt-2 text-xs text-danger-600">
                {item.lastError || "O servidor recusou este envio."}
              </Text>
            ) : (
              <Text className="mt-2 text-xs text-gray-500">
                {item.attempts === 0
                  ? "Aguardando conexão."
                  : `Aguardando nova tentativa (${item.attempts} ${
                      item.attempts === 1 ? "tentativa" : "tentativas"
                    }).`}
              </Text>
            )}
          </View>
        </View>

        {isFailed && (
          <View className="mt-4 flex-row gap-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onPress={() => setItemToDiscard(item)}
            >
              Descartar
            </Button>

            <Button
              size="sm"
              className="flex-1"
              onPress={() => void retryOutboxItem(item.id)}
            >
              Tentar de novo
            </Button>
          </View>
        )}
      </View>
    );
  };

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-row items-center gap-3 border-b border-gray-200 bg-white px-4 py-4">
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            onPress={() => router.back()}
            className="h-9 w-9 items-center justify-center rounded-full bg-gray-100"
          >
            <Ionicons name="arrow-back" size={18} color="#374151" />
          </TouchableOpacity>

          <View className="flex-1">
            <Text className="text-lg font-semibold text-gray-900">
              Envios pendentes
            </Text>
            <Text className="text-xs text-gray-500">
              Registros salvos no aparelho aguardando o servidor
            </Text>
          </View>
        </View>

        <StatusBanners />

        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <View className="items-center px-6 py-16">
              <Ionicons
                name="checkmark-done-outline"
                size={40}
                color="#9ca3af"
              />

              <Text className="mt-4 text-center text-base font-medium text-gray-700">
                Nada pendente
              </Text>
              <Text className="mt-1 text-center text-sm text-gray-500">
                Todos os checklists e abastecimentos já foram enviados.
              </Text>
            </View>
          }
        />

        {items.length > 0 && (
          <View className="border-t border-gray-200 bg-white px-6 py-4">
            <Button
              onPress={() => void processOutbox()}
              loading={isProcessing}
              disabled={isProcessing}
              fullWidth
            >
              {isProcessing ? "Enviando..." : "Tentar enviar agora"}
            </Button>
          </View>
        )}

        <ConfirmModal
          visible={itemToDiscard !== null}
          title="Descartar envio?"
          message="Os dados e as fotos salvos neste aparelho serão removidos. Esta ação não pode ser desfeita."
          confirmText="Descartar"
          confirmVariant="danger"
          onConfirm={() => void confirmDiscard()}
          onCancel={() => setItemToDiscard(null)}
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default PendingSubmissionsScreen;
