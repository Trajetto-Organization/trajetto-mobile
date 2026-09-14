import { Text, TouchableOpacity, View } from "react-native";

import { Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useDeliveriesAccess } from "@/features/deliveries/hooks/use-deliveries-access";
import { useChatUnread } from "@/features/chat/hooks/use-chat-unread";

interface TabDescriptor {
  name: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
}

const TABS: TabDescriptor[] = [
  {
    name: "vehicles",
    label: "Início",
    icon: "home-outline",
    iconActive: "home",
  },
  {
    name: "deliveries",
    label: "Entregas",
    icon: "cube-outline",
    iconActive: "cube",
  },
  {
    name: "chat",
    label: "Chat",
    icon: "chatbubbles-outline",
    iconActive: "chatbubbles",
  },
];

/**
 * The floating glass pill at the bottom: translucent white over the page's
 * gray, hairline border and a soft shadow — the professional look without
 * expo-blur, which would demand a new dev-client build. Swapping the
 * background for a BlurView later is a one-spot change.
 *
 * Reserved in layout flow, not overlaid: no screen needs padding surgery to
 * keep its content reachable.
 */
const GlassTabBar = ({ state, navigation }: BottomTabBarProps) => {
  const insets = useSafeAreaInsets();

  const hasDeliveries = useDeliveriesAccess();
  const { unreadCount } = useChatUnread();

  const focusedName = state.routes[state.index]?.name;

  // The conversation owns the whole bottom (composer, keyboard, recorder);
  // its own back arrow returns to the tabs.
  if (focusedName === "chat") return null;

  const visibleTabs = TABS.filter(
    (tab) => tab.name === "vehicles" || hasDeliveries,
  );

  // Managers see no bar at all — a lone "Início" pill would be noise. The
  // spacer keeps their content clear of the gesture area the SafeAreaView
  // no longer pads (the bar normally absorbs that inset).
  if (visibleTabs.length <= 1) {
    return <View style={{ height: insets.bottom }} className="bg-gray-50" />;
  }

  return (
    <View
      className="bg-gray-50 px-6 pt-2"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      <View
        className="flex-row rounded-3xl border border-white/70 px-2 py-1.5"
        style={{
          /**
           * Opaque, not `bg-white/85`, and that is the whole point.
           *
           * Android draws an elevation shadow from the view's OUTLINE, and it
           * only takes the rounded outline when the background is opaque. Over
           * a translucent one it falls back to the bounding box, which paints
           * a hard square behind the rounded pill — the "white rectangle from
           * the middle down" this replaces. The look barely moves: 85% white
           * over the page's #f9fafb is within a hair of solid white anyway.
           */
          backgroundColor: "#ffffff",
          shadowColor: "#0f172a",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.12,
          shadowRadius: 16,
          elevation: 10,
        }}
      >
        {visibleTabs.map((tab) => {
          const route = state.routes.find((entry) => entry.name === tab.name);

          if (!route) return null;

          const isFocused = focusedName === tab.name;
          const showBadge = tab.name === "chat" && unreadCount > 0;

          const handlePress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={tab.name}
              onPress={handlePress}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={tab.label}
              className="flex-1 items-center rounded-2xl py-2"
            >
              <View>
                <Ionicons
                  name={isFocused ? tab.iconActive : tab.icon}
                  size={22}
                  color={isFocused ? "#2563eb" : "#6b7280"}
                />
                {showBadge && (
                  <View
                    className="absolute -right-2.5 -top-1.5 h-4 min-w-4
                    items-center justify-center rounded-full bg-red-500 px-1"
                  >
                    <Text className="text-[10px] font-bold text-white">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                className={`mt-0.5 text-[11px] ${
                  isFocused
                    ? "font-semibold text-blue-600"
                    : "font-medium text-gray-500"
                }`}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const TabsLayout = () => {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="vehicles" />
      <Tabs.Screen name="deliveries" />
      <Tabs.Screen name="chat" />
    </Tabs>
  );
};

export default TabsLayout;
