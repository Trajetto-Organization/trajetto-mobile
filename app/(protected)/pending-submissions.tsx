import { useState } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";
import Toast from "react-native-toast-message";

import { ProtectedRoute } from "../../components/protected-route";
import { StatusBanners } from "../../components/status-banners";
import { Button, ConfirmModal } from "../../components/ui";

import { useAuthStore } from "@/store/auth-store";
import { useOutboxStore, selectPendingCount } from "@/store/outbox-store";
import {
  discardOutboxItem,
  retryOutboxItem,
  type OutboxItem,
} from "@/features/submissions/outbox";

import {
  SEND_NOW_INCOMPLETE_MESSAGE,
  classifyOwnership,
} from "@/features/submissions/outbox-rules";
import { queueAgeWarning } from "@/features/submissions/outbox-schema";
import { getSubmissionOwner } from "@/features/submissions/submission-owner";
import {
  describePendingItem,
  type PendingTone,
} from "@/features/submissions/pending-item-rules";
import { useSendPendingNow } from "@/features/submissions/use-send-pending-now";
import { reviewRouteOf } from "@/features/occurrences/occurrence-queue-rules";
import { useThemeColors } from "@/hooks/use-theme";

const KIND_LABEL: Record<OutboxItem["kind"], string> = {
  checklist: "Checklist",
  fuel: "Abastecimento",
  "delivery-start-route": "Início de rota",
  "delivery-arrival": "Chegada da entrega",
  "delivery-proof": "Comprovação de entrega",
  "delivery-delivered": "Comprovação de entrega",
  "delivery-occurrence": "Ocorrência da entrega",
  "delivery-pause-start": "Início de pausa",
  "delivery-pause-end": "Fim de pausa",
  "delivery-on-the-way": "Aviso de a caminho",
};

/** One icon per kind: every delivery step used to wear the fuel drop. */
const KIND_ICON: Record<OutboxItem["kind"], keyof typeof Ionicons.glyphMap> = {
  checklist: "clipboard-outline",
  fuel: "water-outline",
  "delivery-start-route": "navigate-outline",
  "delivery-arrival": "location-outline",
  "delivery-proof": "document-text-outline",
  "delivery-delivered": "document-text-outline",
  "delivery-occurrence": "alert-circle-outline",
  "delivery-pause-start": "cafe-outline",
  "delivery-pause-end": "play-circle-outline",
  "delivery-on-the-way": "navigate-circle-outline",
};

// `icon` names a theme token, read as a value where the icon is drawn, so
// the badge follows the theme like the classes around it.
const TONE_STYLE: Record<
  PendingTone,
  { badge: string; icon: "primary" | "warning" | "destructive"; text: string }
> = {
  neutral: { badge: "bg-primary-soft", icon: "primary", text: "text-muted" },
  warning: { badge: "bg-warning-soft", icon: "warning", text: "text-warning" },
  danger: { badge: "bg-destructive-soft", icon: "destructive", text: "text-destructive" },
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
  const colors = useThemeColors();

  const items = useOutboxStore((state) => state.items);
  const activeItemId = useOutboxStore((state) => state.activeItemId);

  // The queue lists this driver's items of every company; an occurrence is
  // reviewed only under its own, whose catalog the review reads.
  const businessId = useAuthStore((state) => state.user?.businessId ?? null);

  // Only this driver's own queue answers to "send now". A footer button that
  // did nothing would be worse than no button at all.
  const pendingCount = useOutboxStore(selectPendingCount);

  const activeProgress = useOutboxStore((state) => state.activeProgress);

  // The logout warning's "Enviar agora" too: items waiting on their backoff
  // go now. A plain pass skipped them, so the button spun and sent nothing
  // for exactly the items that had failed on a weak signal.
  const {
    send: sendNow,
    isSending,
    incomplete: sendIncomplete,
  } = useSendPendingNow();

  const [itemToDiscard, setItemToDiscard] = useState<OutboxItem | null>(null);

  const trySendNow = async () => {
    const { incomplete } = await sendNow();
    if (incomplete) return;

    Toast.show({
      type: "success",
      text1: "Envios concluídos",
      text2: "O que aguardava conexão chegou à empresa.",
      position: "top",
    });
  };

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

    // Why it is still here and what the driver can do about it, from one
    // rule (pending-item-rules): rejected, unclaimed, expired, or parked
    // until the company switches a module back on.
    const view = describePendingItem(
      item,
      classifyOwnership(item, getSubmissionOwner()),
      Date.now(),
      { businessId },
    );
    const tone = TONE_STYLE[view.tone];

    // Only ever a flag: an old item is still the driver's work, never deleted
    // for its age. Not on an expired departure, where "Envie" is the one
    // thing that cannot work.
    const ageWarning = view.isExpired
      ? null
      : queueAgeWarning(item.createdAt, Date.now());

    const hasActions =
      view.canDiscard || view.retryLabel !== null || Boolean(view.reviewLabel);

    // An occurrence — or a delivery proof (decision 14.3) — refused over its
    // form reopens on its own screen with what was collected (contract §6);
    // the delivery comes from the item's own URL.
    const reviewRoute = view.reviewLabel ? reviewRouteOf(item) : null;

    return (
      <View
        testID={`pending-item-${item.kind}`}
        className="mb-3 rounded-xl border border-border bg-card p-4"
      >
        <View className="flex-row items-start gap-3">
          <View
            className={`h-9 w-9 items-center justify-center rounded-full ${tone.badge}`}
          >
            <Ionicons name={KIND_ICON[item.kind]} size={18} color={colors[tone.icon]} />
          </View>

          <View className="flex-1">
            <Text className="text-base font-semibold text-ink">
              {KIND_LABEL[item.kind]}
            </Text>

            <Text className="text-xs text-muted">
              {item.vehicleLabel ? `${item.vehicleLabel} · ` : ""}
              {formatCreatedAt(item.createdAt)}
            </Text>

            {ageWarning && (
              <Text
                className={`mt-1 text-xs font-medium ${
                  ageWarning.level === "critical"
                    ? "text-destructive"
                    : "text-warning"
                }`}
              >
                Na fila há {ageWarning.days} dias. Envie ou fale com o gestor.
              </Text>
            )}

            {isActive && activeProgress ? (
              <Text className="mt-2 text-xs font-medium text-primary">
                Enviando… {activeProgress.uploaded} de {activeProgress.total}{" "}
                {activeProgress.total === 1 ? "foto" : "fotos"}
              </Text>
            ) : (
              <Text className={`mt-2 text-xs ${tone.text}`}>{view.message}</Text>
            )}
          </View>
        </View>

        {hasActions && (
          <View className="mt-4 flex-row gap-3">
            {view.canDiscard && (
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onPress={() => setItemToDiscard(item)}
                testID="pending-discard"
              >
                Descartar
              </Button>
            )}

            {view.retryLabel !== null && (
              <Button
                size="sm"
                className="flex-1"
                onPress={() => void retryOutboxItem(item.id)}
                testID="pending-retry"
              >
                {view.retryLabel}
              </Button>
            )}

            {view.reviewLabel && reviewRoute && (
              <Button
                size="sm"
                className="flex-1"
                onPress={() => router.navigate(reviewRoute)}
                testID="pending-review"
              >
                {view.reviewLabel}
              </Button>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-row items-center gap-3 border-b border-border bg-surface px-4 py-4">
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            onPress={() => router.back()}
            className="h-9 w-9 items-center justify-center rounded-full bg-subtle"
          >
            <Ionicons name="arrow-back" size={18} color={colors.inkSoft} />
          </TouchableOpacity>

          <View className="flex-1">
            <Text className="text-lg font-semibold text-ink">
              Envios pendentes
            </Text>
            <Text className="text-xs text-muted">
              Registros salvos no aparelho aguardando o servidor
            </Text>
          </View>
        </View>

        <StatusBanners />

        <FlatList
          data={items}
          testID="pending-list"
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <View className="items-center px-6 py-16">
              <Ionicons
                name="checkmark-done-outline"
                size={40}
                color={colors.muted}
              />

              <Text className="mt-4 text-center text-base font-medium text-ink-soft">
                Nada pendente
              </Text>
              <Text className="mt-1 text-center text-sm text-muted">
                Todos os registros já foram enviados.
              </Text>
            </View>
          }
        />

        {pendingCount > 0 && (
          <View className="border-t border-border bg-surface px-6 py-4">
            {sendIncomplete && !isSending && (
              <View
                className="mb-3 flex-row gap-2"
                accessibilityRole="alert"
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={16}
                  color={colors.warning}
                  style={{ marginTop: 2 }}
                />
                <Text className="flex-1 text-sm leading-5 text-warning">
                  {SEND_NOW_INCOMPLETE_MESSAGE}
                </Text>
              </View>
            )}

            <Button
              onPress={() => void trySendNow()}
              testID="pending-send-now"
              loading={isSending}
              disabled={isSending}
              fullWidth
            >
              {isSending ? "Enviando..." : "Tentar enviar agora"}
            </Button>
          </View>
        )}

        <ConfirmModal
          visible={itemToDiscard !== null}
          testID="pending-discard-modal"
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
