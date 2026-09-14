import { Text, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { BannerCollapse } from "@/components/ui/banner-collapse";
import { useConnectionStore } from "@/store/connection-store";

/**
 * Tells the driver the app is not talking to the server, without stopping them.
 *
 * Non-blocking on purpose, and this is the whole design decision. The web gets a
 * full-screen block when its API is down because there is genuinely nothing to
 * do there — no API, no page. Here the opposite is true: the query cache is
 * persisted, checklists and refuellings save as drafts, and submissions are
 * queued with an idempotency key so they can be sent later exactly once. A
 * driver in a basement garage can keep working through the entire checklist.
 * Covering the screen would throw away the offline support the app was
 * deliberately built with.
 *
 * So the banner informs and gets out of the way. What it must convey is not
 * "something is wrong" — the driver can see that — but "your work is not lost".
 */
const OfflineBanner = () => {
  const isDeviceOffline = useConnectionStore((state) => state.isDeviceOffline);
  const isApiUnreachable = useConnectionStore(
    (state) => state.isApiUnreachable,
  );

  const isVisible = isDeviceOffline || isApiUnreachable;

  // The device being offline is the driver's own situation and needs no
  // explanation; the API being unreachable on full signal does, otherwise the
  // app just looks broken.
  const { icon, title, detail } = isDeviceOffline
    ? {
        icon: "cloud-offline-outline" as const,
        title: "Sem conexão",
        detail: "Seus dados serão enviados quando a conexão voltar.",
      }
    : {
        icon: "server-outline" as const,
        title: "Servidor indisponível",
        detail: "Estamos tentando reconectar. Seus dados estão salvos.",
      };

  return (
    <BannerCollapse visible={isVisible}>
      <View
        accessibilityRole="alert"
        // Hidden from screen readers too when it is not showing; an invisible
        // element is still announced otherwise.
        accessibilityElementsHidden={!isVisible}
        importantForAccessibility={isVisible ? "yes" : "no-hide-descendants"}
        className="bg-amber-500"
      >
        <View className="flex-row items-center gap-3 px-4 py-2.5">
          <Ionicons name={icon} size={18} color="#ffffff" />

          <View className="flex-1">
            <Text className="text-sm font-semibold text-white">{title}</Text>
            <Text className="text-xs text-white/90">{detail}</Text>
          </View>
        </View>
      </View>
    </BannerCollapse>
  );
};

export { OfflineBanner };
