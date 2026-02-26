import { Pressable, Text, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";

import { cn } from "../../utils/cn";

interface ButtonProps {
  onPress?: () => void;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  fullWidth?: boolean;
}

const variantStyles = {
  primary: "bg-primary-600",
  secondary: "bg-gray-600",
  outline: "border border-primary-600 bg-transparent",
  ghost: "bg-transparent",
  danger: "bg-danger-600",
};

const variantTextStyles = {
  primary: "text-white",
  secondary: "text-white",
  outline: "text-primary-600",
  ghost: "text-gray-700",
  danger: "text-white",
};

const sizeStyles = {
  sm: "px-3 py-2 rounded-md",
  md: "px-4 py-3 rounded-lg",
  lg: "px-6 py-4 rounded-xl",
};

const textSizeStyles = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
};

export const Button: React.FC<ButtonProps> = ({
  onPress,
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  className = "",
  fullWidth = false,
}) => {
  const isDisabled = disabled || loading;

  const handlePress = () => {
    if (isDisabled || !onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      style={({ pressed }) => ({
        opacity: pressed && !isDisabled ? 0.7 : 1,
        transform: [{ scale: pressed && !isDisabled ? 0.97 : 1 }],
      })}
      className={cn(
        "flex-row items-center justify-center",
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && "w-full",
        isDisabled && "opacity-50",
        className,
      )}
    >
      {loading && (
        <ActivityIndicator
          size="small"
          color={
            variant === "outline" || variant === "ghost" ? "#3b82f6" : "#ffffff"
          }
          className="mr-2"
        />
      )}
      <Text
        className={cn(
          "font-medium text-center",
          variantTextStyles[variant],
          textSizeStyles[size],
          loading && "ml-2",
        )}
      >
        {children}
      </Text>
    </Pressable>
  );
};
