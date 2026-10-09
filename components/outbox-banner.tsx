import { useRef } from "react";
import { Pressable, Text, View } from "react-native";

import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { BannerCollapse } from "@/components/ui/banner-collapse";
import { useThemeColors } from "@/hooks/use-theme";

import {
  selectNeedsAttentionCount,
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
  const colors = useThemeColors();

  const pendingCount = useOutboxStore(selectPendingCount);

  const isProcessing = useOutboxStore((state) => state.isProcessing);

  // Unclaimed and parked submissions are grouped with the rejected ones
  // rather than the waiting ones: none leaves with a connection alone (a
  // person, or the company re-enabling a module, has to act), and promising
  // that it "will be sent once there is a connection" would be false. This
  // strip is also the only way to the pending screen (MOB-03).
  const attentionCount = useOutboxStore(selectNeedsAttentionCount);
  const total = pendingCount + attentionCount;

  // The last real content survives the exit animation — when the queue drains
  // to zero, the strip collapses still reading "Enviando…" instead of
  // flashing "0 envios pendentes" on its way out.
  const lastContent = useRef<BannerContent | null>(null);

  if (total > 0) {
    // Something rejected on the merits outranks something merely waiting: one
    // needs the driver, the other needs only time.
    const needsAttention = attentionCount > 0;

    lastContent.current = {
      needsAttention,
      label: needsAttention
        ? `${attentionCount} ${attentionCount === 1 ? "envio precisa" : "envios precisam"} de atenção`
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

  // Full class names, so Tailwind's scanner sees them. The detail is full
  // white too: white/90 on the primary surface measured 4.49:1, under AA.
  const tone = content.needsAttention
    ? {
        surface: "bg-destructive",
        title: "text-destructive-foreground",
        detail: "text-destructive-foreground",
        icon: colors.destructiveForeground,
      }
    : {
        surface: "bg-primary",
        title: "text-primary-foreground",
        detail: "text-primary-foreground",
        icon: colors.primaryForeground,
      };

  return (
    <BannerCollapse visible={total > 0}>
      <View
        className={tone.surface}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${content.label}. ${content.detail}`}
          // navigate (not push): a double-tap must not stack two copies.
          onPress={() => router.navigate("/pending-submissions")}
          testID="outbox-banner"
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
            color={tone.icon}
          />

          <View className="flex-1">
            <Text className={`text-sm font-semibold ${tone.title}`}>
              {content.label}
            </Text>
            <Text className={`text-xs ${tone.detail}`}>{content.detail}</Text>
          </View>

          <Ionicons name="chevron-forward" size={16} color={tone.icon} />
        </Pressable>
      </View>
    </BannerCollapse>
  );
};

export { OutboxBanner };
