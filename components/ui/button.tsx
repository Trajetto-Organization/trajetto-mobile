import { Pressable, Text, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";

import { useThemeColors } from "../../hooks/use-theme";
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
  /** Stable handle for the Maestro E2E flows (docs/testes.md, Maestro section). */
  testID?: string;
}

// Tokens (docs/arquitetura.md, theme section): `bg-primary` / `bg-destructive` are the deep
// surfaces behind white text in both themes; outline and ghost sit on the
// page and use the readable colours.
const variantStyles = {
  primary: "bg-primary",
  secondary: "bg-subtle border border-border",
  outline: "border border-primary bg-transparent",
  ghost: "bg-transparent",
  danger: "bg-destructive",
};

const variantTextStyles = {
  primary: "text-primary-foreground",
  secondary: "text-ink",
  outline: "text-primary",
  ghost: "text-ink-soft",
  danger: "text-destructive-foreground",
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
  testID,
}) => {
  const isDisabled = disabled || loading;
  const colors = useThemeColors();

  const handlePress = () => {
    if (isDisabled || !onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
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
            variant === "outline"
              ? colors.primary
              : variant === "ghost" || variant === "secondary"
                ? colors.inkSoft
                : colors.primaryForeground
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
