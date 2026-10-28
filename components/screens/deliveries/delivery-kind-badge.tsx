import { Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  deliveryKindBadge,
  type BadgedDeliveryKind,
} from "@/features/deliveries/delivery-identity-rules";
import { useThemeColors } from "@/hooks/use-theme";

const KIND_ICON: Record<BadgedDeliveryKind, keyof typeof Ionicons.glyphMap> = {
  PICKUP: "archive-outline",
  SERVICE_ORDER: "construct-outline",
};

/**
 * "Coleta" / "Ordem de serviço", on the card and the delivery screen.
 * Neutral on purpose: the module accents identify modules, not kinds
 * (docs/arquitetura.md, theme section, rule 11). Renders nothing for a plain
 * delivery, an absent kind (older API or cache) or one this build does not
 * know.
 */
const DeliveryKindBadge = ({ kind }: { kind: unknown }) => {
  const colors = useThemeColors();
  const badge = deliveryKindBadge(kind);

  if (!badge) return null;

  return (
    <View
      testID="delivery-kind-badge"
      accessibilityRole="text"
      className="flex-row items-center gap-1 rounded-full border border-border bg-subtle px-2 py-0.5"
    >
      <Ionicons name={KIND_ICON[badge.kind]} size={11} color={colors.inkSoft} />
      <Text className="text-[11px] font-medium text-ink-soft" numberOfLines={1}>
        {badge.label}
      </Text>
    </View>
  );
};

export { DeliveryKindBadge };
