import { View, ActivityIndicator, Text } from "react-native";

interface LoadingSpinnerProps {
  size?: "small" | "large";
  color?: string;
  text?: string;
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "large",
  color = "#3b82f6",
  text,
  className = "",
}) => {
  return (
    <View className={`flex-1 justify-center items-center ${className}`}>
      <ActivityIndicator size={size} color={color} />
      {text && <Text className="text-gray-600 mt-4 text-center">{text}</Text>}
    </View>
  );
};
