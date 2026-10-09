import { useState } from "react";
import {
  FlatList,
  Linking,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ProtectedRoute } from "../../components/protected-route";
import { LoadingSpinner } from "../../components/ui";

import {
  useMarkNotificationRead,
  useNotificationsList,
  useUnreadNotificationsCount,
  type AppNotification,
} from "@/features/notifications/use-notifications";
import { openableNotificationLink } from "@/features/notifications/notification-link-rules";
import {
  PROOF_FEEDBACK_NOTIFICATION_TYPE,
  notificationDeliveryTarget,
} from "@/features/notifications/proof-feedback-rules";
import { hasDeliveriesAccess } from "@/features/access/module-rules";
import { useAuthStore } from "@/store/auth-store";
import { useThemeColors } from "@/hooks/use-theme";

import { refreshWithConnectionFeedback } from "@/utils/pull-to-refresh";
import { StatusBanners } from "@/components/status-banners";

interface TypeVisual {
  icon: keyof typeof Ionicons.glyphMap;
  /** The theme token the icon is drawn in (a value, so it follows the theme). */
  tone: "destructive" | "warning" | "success" | "primary" | "inkSoft";
  /** The icon's round chip, a soft tint of the same family. */
  chip: string;
}

/**
 * One accent per notification type, mirroring the web bell: the color does
 * the first pass of reading so the driver can scan the list by kind. Only
 * the theme's state colours, so each one reads on both themes' cards; the
 * module accents are left to identify the modules (docs/arquitetura.md, theme section, rule 11).
 */
const TYPE_VISUAL: Record<string, TypeVisual> = {
  fine: {
    icon: "alert-circle-outline",
    tone: "destructive",
    chip: "bg-destructive-soft",
  },
  "service-order": {
    icon: "construct-outline",
    tone: "warning",
    chip: "bg-warning-soft",
  },
  "account-payable": {
    icon: "receipt-outline",
    tone: "success",
    chip: "bg-success-soft",
  },
  // Unread rows sit on primary-soft already: the primary chip is the card.
  "kanban-card": {
    icon: "grid-outline",
    tone: "primary",
    chip: "bg-card",
  },
  "master-user": {
    icon: "person-outline",
    tone: "inkSoft",
    chip: "bg-subtle",
  },
  // The automatic reading of a proof photo pointed at a problem (6.9).
  [PROOF_FEEDBACK_NOTIFICATION_TYPE]: {
    icon: "document-text-outline",
    tone: "warning",
    chip: "bg-warning-soft",
  },
};

const DEFAULT_VISUAL: TypeVisual = {
  icon: "notifications-outline",
  tone: "primary",
  chip: "bg-card",
};

const relativeDate = (value: string): string => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
};

/**
 * The notification list — the bell's destination.
 *
 * Tapping a card marks it read and follows its web link, if it has one; a
 * proof warning opens its delivery in the app instead, where the driver can
 * act on it. Read state syncs optimistically so the list feels instant even
 * on a slow connection.
 */
const NotificationsScreen = () => {
  const router = useRouter();
  const colors = useThemeColors();

  const {
    notifications,
    isLoading,
    isFetching,
    isError,
    hasNextPage,
    loadMore,
    refetch,
  } = useNotificationsList();

  const unreadCount = useUnreadNotificationsCount();
  const { mutate: markAsRead } = useMarkNotificationRead();

  // A proof warning opens its delivery here, in the app (decision 6.9).
  const canOpenDeliveries = useAuthStore((state) =>
    hasDeliveriesAccess(state.user),
  );

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    // Re-entrancy guard: a second pull while one refresh is in flight would
    // re-toggle `refreshing` mid-animation — the stuck-spinner recipe.
    if (refreshing) return;
    setRefreshing(true);

    try {
      await refreshWithConnectionFeedback(refetch);
    } finally {
      setRefreshing(false);
    }
  };

  const renderItem = ({ item }: { item: AppNotification }) => {
    const visual = TYPE_VISUAL[item.type] ?? DEFAULT_VISUAL;

    // Kanban, service orders, master users — the subject of many
    // notifications lives on the web dashboard. Tapping marks it read and
    // follows the same link the web bell would, in the browser. Only a web
    // link: `openURL` would follow `intent://`, `tel:` or any app's scheme.
    const link = openableNotificationLink(item.link);

    // What the row is about lives in the app: its link points at the web
    // inbox, which is no use to a driver in the street.
    const deliveryId = notificationDeliveryTarget(item, canOpenDeliveries);

    const handlePress = () => {
      if (!item.read) markAsRead(item.id);

      if (deliveryId) {
        router.navigate({
          pathname: "/delivery-detail",
          params: { id: deliveryId },
        });

        return;
      }

      if (link) {
        void Linking.openURL(link).catch(() => undefined);
      }
    };

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={handlePress}
        className={`mb-3 rounded-xl border p-4 ${
          item.read ? "border-border bg-card" : "border-primary/40 bg-primary-soft"
        }`}
      >
        <View className="flex-row items-start gap-3">
          <View
            className={`h-9 w-9 items-center justify-center rounded-full ${
              item.read ? "bg-subtle" : visual.chip
            }`}
          >
            <Ionicons
              name={visual.icon}
              size={18}
              color={item.read ? colors.muted : colors[visual.tone]}
            />
          </View>

          <View className="flex-1">
            <View className="flex-row items-baseline justify-between gap-2">
              <Text
                className={`flex-1 text-base ${
                  item.read
                    ? "font-medium text-ink-soft"
                    : "font-semibold text-ink"
                }`}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              <Text className="text-xs text-muted">
                {relativeDate(item.created_at)}
              </Text>
            </View>

            <Text className="mt-1 text-sm text-muted" numberOfLines={3}>
              {item.message}
            </Text>

            {deliveryId ? (
              <View className="mt-2 flex-row items-center gap-1">
                <Ionicons name="cube-outline" size={12} color={colors.muted} />
                <Text className="text-xs text-muted">
                  Toque para ver a entrega
                </Text>
              </View>
            ) : link ? (
              <View className="mt-2 flex-row items-center gap-1">
                <Ionicons name="open-outline" size={12} color={colors.muted} />
                <Text className="text-xs text-muted">
                  Toque para abrir no sistema
                </Text>
              </View>
            ) : null}
          </View>

          {/* Same red as the bell badge — one "attention" color everywhere. */}
          {!item.read && (
            <View className="mt-1 h-2.5 w-2.5 rounded-full bg-destructive" />
          )}
        </View>
      </TouchableOpacity>
    );
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
            <Text className="text-lg font-bold text-ink">
              Notificações
            </Text>
            <Text className="text-xs text-muted">
              {unreadCount === 0
                ? "Tudo em dia"
                : `${unreadCount} não ${unreadCount === 1 ? "lida" : "lidas"}`}
            </Text>
          </View>
        </View>

        <StatusBanners />

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <LoadingSpinner size="large" text="Carregando notificações..." />
          </View>
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, flexGrow: 1 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void handleRefresh()}
                colors={[colors.primarySurface]}
                tintColor={colors.primary}
                progressBackgroundColor={colors.card}
              />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              hasNextPage && isFetching ? (
                <View className="py-4">
                  <LoadingSpinner size="small" text="Carregando mais..." />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center px-8">
                <Ionicons
                  name={isError ? "cloud-offline-outline" : "notifications-off-outline"}
                  size={40}
                  color={colors.muted}
                />
                <Text className="mt-4 text-center text-base font-semibold text-ink-soft">
                  {isError
                    ? "Não foi possível carregar"
                    : "Nenhuma notificação"}
                </Text>
                <Text className="mt-1 text-center text-sm text-muted">
                  {isError
                    ? "Verifique sua conexão e puxe para atualizar."
                    : "Novos avisos aparecerão aqui."}
                </Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default NotificationsScreen;
