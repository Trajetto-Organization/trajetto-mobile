import React from "react";

import { View, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

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

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
  className = "",
  children,
}) => {
  const shimmerTranslate = useSharedValue(-screenWidth);

  React.useEffect(() => {
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
      <View className={`bg-gray-200 overflow-hidden ${className}`}>
        <View className="opacity-30">{children}</View>
        <AnimatedLinearGradient
          colors={["transparent", "rgba(255,255,255,0.8)", "transparent"]}
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
    <View className={`bg-gray-200 overflow-hidden ${className}`}>
      <AnimatedLinearGradient
        colors={["transparent", "rgba(255,255,255,0.8)", "transparent"]}
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
