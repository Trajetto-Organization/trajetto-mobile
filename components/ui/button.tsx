import React from "react";

import { TouchableOpacity, Text, ActivityIndicator } from "react-native";
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
  primary: "bg-primary-600 active:bg-primary-700",
  secondary: "bg-gray-600 active:bg-gray-700",
  outline: "border border-primary-600 bg-transparent active:bg-primary-50",
  ghost: "bg-transparent active:bg-gray-100",
  danger: "bg-danger-600 active:bg-danger-700",
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

  return (
    <TouchableOpacity
      onPress={!isDisabled ? onPress : undefined}
      disabled={isDisabled}
      className={cn(
        "flex-row items-center justify-center",
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && "w-full",
        isDisabled && "opacity-50",
        className
      )}
      activeOpacity={0.8}
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
          loading && "ml-2"
        )}
      >
        {children}
      </Text>
    </TouchableOpacity>
  );
};
