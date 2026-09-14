import { useRef } from "react";
import { Pressable, Text, View } from "react-native";

import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { BannerCollapse } from "@/components/ui/banner-collapse";

import {
  selectFailedCount,
  selectPendingCount,
  useOutboxStore,
} from "@/store/outbox-store";

interface BannerContent {
  needsAttention: boolean;
  label: string;
  detail: string;
}

/**
 * Says that finished work is waiting to be sent, and that nothing was lost.
 *
 * Without this the queue would be invisible: a driver who submits a checklist
 * with no signal sees it accepted and the screen close, with no way to tell
 * whether it ever reached the company. Silence there is worse than an error,
 * because it looks like success.
 */
const OutboxBanner = () => {
  const router = useRouter();

  const pendingCount = useOutboxStore(selectPendingCount);
  const failedCount = useOutboxStore(selectFailedCount);

  const isProcessing = useOutboxStore((state) => state.isProcessing);
  const total = pendingCount + failedCount;

  // The last real content survives the exit animation — when the queue drains
  // to zero, the strip collapses still reading "Enviando…" instead of
  // flashing "0 envios pendentes" on its way out.
  const lastContent = useRef<BannerContent | null>(null);

  if (total > 0) {
    // Something rejected on the merits outranks something merely waiting: one
    // needs the driver, the other needs only time.
    const needsAttention = failedCount > 0;

    lastContent.current = {
      needsAttention,
      label: needsAttention
        ? `${failedCount} ${failedCount === 1 ? "envio precisa" : "envios precisam"} de atenção`
        : isProcessing
          ? "Enviando registros pendentes…"
          : `${pendingCount} ${pendingCount === 1 ? "envio pendente" : "envios pendentes"}`,
      detail: needsAttention
        ? "Toque para ver o motivo."
        : "Serão enviados assim que houver conexão.",
    };
  }

  const content = lastContent.current;
  if (!content) return null;

  return (
    <BannerCollapse visible={total > 0}>
      <View
        className={content.needsAttention ? "bg-danger-600" : "bg-primary-600"}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${content.label}. ${content.detail}`}
          // navigate (not push): a double-tap must not stack two copies.
          onPress={() => router.navigate("/pending-submissions")}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          className="flex-row items-center gap-3 px-4 py-2.5"
        >
          <Ionicons
            name={
              content.needsAttention
                ? "alert-circle-outline"
                : "cloud-upload-outline"
            }
            size={18}
            color="#ffffff"
          />

          <View className="flex-1">
            <Text className="text-sm font-semibold text-white">
              {content.label}
            </Text>
            <Text className="text-xs text-white/90">{content.detail}</Text>
          </View>

          <Ionicons name="chevron-forward" size={16} color="#ffffff" />
        </Pressable>
      </View>
    </BannerCollapse>
  );
};

export { OutboxBanner };
