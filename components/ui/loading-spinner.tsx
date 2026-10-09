import { View, ActivityIndicator, Text } from "react-native";

import { useThemeColors } from "../../hooks/use-theme";

interface LoadingSpinnerProps {
  size?: "small" | "large";
  color?: string;
  text?: string;
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "large",
  color,
  text,
  className = "",
}) => {
  const colors = useThemeColors();

  return (
    <View className={`flex-1 justify-center items-center ${className}`}>
      <ActivityIndicator size={size} color={color ?? colors.primary} />
      {text && <Text className="text-muted mt-4 text-center">{text}</Text>}
    </View>
  );
};
