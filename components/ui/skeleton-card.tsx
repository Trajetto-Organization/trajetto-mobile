import { useEffect } from "react";

import { View, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useColorSchemeName } from "../../hooks/use-theme";

import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const { width: screenWidth } = Dimensions.get("window");

interface SkeletonCardProps {
  className?: string;
  children?: React.ReactNode;
}

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

// The sheen that sweeps the placeholder: a bright one reads as a flash on the
// dark theme's `bg-border`, so it dims there.
const SHIMMER = {
  light: ["transparent", "rgba(255,255,255,0.8)", "transparent"],
  dark: ["transparent", "rgba(255,255,255,0.08)", "transparent"],
} as const;

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  className = "",
  children,
}) => {
  const shimmerTranslate = useSharedValue(-screenWidth);
  const shimmer = SHIMMER[useColorSchemeName()];

  useEffect(() => {
    shimmerTranslate.value = withRepeat(
      withTiming(screenWidth, { duration: 1500 }),
      -1,
      false
    );
  }, [shimmerTranslate]);

  const shimmerStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: shimmerTranslate.value }],
    };
  });

  if (children) {
    return (
      <View className={`bg-border overflow-hidden ${className}`}>
        <View className="opacity-30">{children}</View>
        <AnimatedLinearGradient
          colors={shimmer}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[
            {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: screenWidth,
            },
            shimmerStyle,
          ]}
        />
      </View>
    );
  }

  return (
    <View className={`bg-border overflow-hidden ${className}`}>
      <AnimatedLinearGradient
        colors={shimmer}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: screenWidth,
          },
          shimmerStyle,
        ]}
      />
    </View>
  );
};
