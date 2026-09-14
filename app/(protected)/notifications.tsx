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

import { refreshWithConnectionFeedback } from "@/utils/pull-to-refresh";
import { StatusBanners } from "@/components/status-banners";

interface TypeVisual {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  chip: string;
}

/**
 * One accent per notification type, mirroring the web bell: the color does
 * the first pass of reading so the driver can scan the list by kind.
 */
const TYPE_VISUAL: Record<string, TypeVisual> = {
  fine: {
    icon: "alert-circle-outline",
    color: "#dc2626",
    chip: "bg-red-500/10",
  },
  "service-order": {
    icon: "construct-outline",
    color: "#d97706",
    chip: "bg-amber-500/10",
  },
  "account-payable": {
    icon: "receipt-outline",
    color: "#059669",
    chip: "bg-emerald-500/10",
  },
  "kanban-card": {
    icon: "grid-outline",
    color: "#7c3aed",
    chip: "bg-violet-500/10",
  },
  "master-user": {
    icon: "person-outline",
    color: "#0284c7",
    chip: "bg-sky-500/10",
  },
};

const DEFAULT_VISUAL: TypeVisual = {
  icon: "notifications-outline",
  color: "#2563eb",
  chip: "bg-primary-600/10",
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
 * Tapping a card only marks it read: the links notifications carry point at
 * the web dashboard, and the driver's actionable work already lives in the
 * app's own screens. Read state syncs optimistically so the list feels
 * instant even on a slow connection.
 */
const NotificationsScreen = () => {
  const router = useRouter();

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
    // follows the same link the web bell would, in the browser.
    const handlePress = () => {
      if (!item.read) markAsRead(item.id);

      if (item.link) {
        void Linking.openURL(item.link).catch(() => undefined);
      }
    };

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={handlePress}
        className={`mb-3 rounded-xl border p-4 ${
          item.read ? "border-gray-200 bg-white" : "border-primary-200 bg-primary-50"
        }`}
      >
        <View className="flex-row items-start gap-3">
          <View
            className={`h-9 w-9 items-center justify-center rounded-full ${
              item.read ? "bg-gray-100" : visual.chip
            }`}
          >
            <Ionicons
              name={visual.icon}
              size={18}
              color={item.read ? "#6b7280" : visual.color}
            />
          </View>

          <View className="flex-1">
            <View className="flex-row items-baseline justify-between gap-2">
              <Text
                className={`flex-1 text-base ${
                  item.read
                    ? "font-medium text-gray-700"
                    : "font-semibold text-gray-900"
                }`}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              <Text className="text-xs text-gray-400">
                {relativeDate(item.created_at)}
              </Text>
            </View>

            <Text className="mt-1 text-sm text-gray-600" numberOfLines={3}>
              {item.message}
            </Text>

            {item.link && (
              <View className="mt-2 flex-row items-center gap-1">
                <Ionicons name="open-outline" size={12} color="#6b7280" />
                <Text className="text-xs text-gray-500">
                  Toque para abrir no sistema
                </Text>
              </View>
            )}
          </View>

          {/* Same red as the bell badge — one "attention" color everywhere. */}
          {!item.read && (
            <View className="mt-1 h-2.5 w-2.5 rounded-full bg-danger-600" />
          )}
        </View>
      </TouchableOpacity>
    );
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
            <Text className="text-lg font-bold text-gray-900">
              Notificações
            </Text>
            <Text className="text-xs text-gray-500">
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
                  color="#9ca3af"
                />
                <Text className="mt-4 text-center text-base font-semibold text-gray-700">
                  {isError
                    ? "Não foi possível carregar"
                    : "Nenhuma notificação"}
                </Text>
                <Text className="mt-1 text-center text-sm text-gray-500">
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
