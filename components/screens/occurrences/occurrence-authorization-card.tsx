import { Text, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import type { AuthorizationTone } from "@/features/occurrences/authorization-rules";
import { useAuthorizationView } from "@/features/occurrences/use-authorization-view";
import { useThemeColors } from "@/hooks/use-theme";
import type { ThemeColors } from "@/utils/theme-rules";
import type {
  DriverDelivery,
  DriverOccurrenceType,
} from "@/features/deliveries/types";

// Token pairs (docs/arquitetura.md, theme section): the title in the tone's readable colour on its
// soft tint, the body in ink-soft, both at 4.5:1 in light and dark.
const TONE: Record<
  AuthorizationTone,
  {
    icon: keyof typeof Ionicons.glyphMap;
    color: keyof ThemeColors;
    box: string;
    title: string;
    text: string;
  }
> = {
  waiting: {
    icon: "hourglass-outline",
    color: "warning",
    box: "border-warning/40 bg-warning-soft",
    title: "text-warning",
    text: "text-ink-soft",
  },
  approved: {
    icon: "checkmark-circle-outline",
    color: "success",
    box: "border-success/40 bg-success-soft",
    title: "text-success",
    text: "text-ink-soft",
  },
  denied: {
    icon: "close-circle-outline",
    color: "destructive",
    box: "border-destructive/40 bg-destructive-soft",
    title: "text-destructive",
    text: "text-ink-soft",
  },
  queued: {
    icon: "cloud-upload-outline",
    color: "inkSoft",
    box: "border-border bg-subtle",
    title: "text-ink",
    text: "text-ink-soft",
  },
  attention: {
    icon: "alert-circle-outline",
    color: "destructive",
    box: "border-destructive/40 bg-destructive-soft",
    title: "text-destructive",
    text: "text-ink-soft",
  },
};

/**
 * On the delivery screen: "Aguardando autorização da torre" while the tower
 * decides (decision 6.3), the answer with its reason once it comes, and what
 * to do next — the proof stays open the whole time.
 */
const OccurrenceAuthorizationCard = ({
  delivery,
  occurrenceTypes,
  className = "",
}: {
  delivery: DriverDelivery;
  occurrenceTypes?: readonly DriverOccurrenceType[];

  /** The outer spacing, applied only when there is something to show. */
  className?: string;
}) => {
  const view = useAuthorizationView(delivery, occurrenceTypes);
  const colors = useThemeColors();

  if (!view) return null;

  const tone = TONE[view.tone];

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className={`rounded-xl border p-4 ${tone.box} ${className}`}
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name={tone.icon} size={20} color={colors[tone.color]} />
        <Text className={`flex-1 text-sm font-semibold ${tone.title}`}>
          {view.title}
        </Text>
      </View>

      {view.message ? (
        <Text className="mt-2 text-sm text-ink">{view.message}</Text>
      ) : null}

      {view.nextStep ? (
        <Text className={`mt-2 text-sm ${tone.text}`}>{view.nextStep}</Text>
      ) : null}

      {view.secondary ? (
        <Text className="mt-2 text-xs text-muted">{view.secondary}</Text>
      ) : null}
    </View>
  );
};

/**
 * The same state in one line, on the day's list. No types passed: the hook
 * reads them from the cached day, so the card and the screen agree.
 */
const OccurrenceAuthorizationBadge = ({ delivery }: { delivery: DriverDelivery }) => {
  const view = useAuthorizationView(delivery);
  const colors = useThemeColors();

  if (!view) return null;

  const tone = TONE[view.tone];

  return (
    <View
      className={`mt-2 flex-row items-center gap-1.5 self-start rounded-full border px-2.5 py-1 ${tone.box}`}
      accessibilityLabel={view.message ? `${view.title}. ${view.message}` : view.title}
    >
      <Ionicons name={tone.icon} size={13} color={colors[tone.color]} />
      <Text className={`text-xs font-medium ${tone.title}`} numberOfLines={1}>
        {view.title}
      </Text>
    </View>
  );
};

export { OccurrenceAuthorizationBadge, OccurrenceAuthorizationCard };
