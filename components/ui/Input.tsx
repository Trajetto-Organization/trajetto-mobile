import { useState } from "react";

import { TextInput, View, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useThemeColors } from "../../hooks/use-theme";
import { cn } from "../../utils/cn";
import { inputFieldStateClasses } from "../../utils/input-field-classes";

interface InputProps {
  label?: string;
  placeholder?: string;
  placeholderTextColor?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  onBlur?: () => void;
  error?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address" | "numeric" | "phone-pad";
  multiline?: boolean;
  numberOfLines?: number;
  editable?: boolean;
  className?: string;
  inputClassName?: string;
  showPasswordToggle?: boolean;
  rightIcon?: React.ReactNode;
  style?: object;
  inputRef?: React.RefObject<TextInput | null>;
  required?: boolean;
  /** Stable handle for the Maestro E2E flows (docs/testes.md, Maestro section). */
  testID?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  placeholder,
  placeholderTextColor,
  value,
  onChangeText,
  onBlur,
  error,
  secureTextEntry = false,
  autoCapitalize = "sentences",
  keyboardType = "default",
  multiline = false,
  numberOfLines = 1,
  editable = true,
  className = "",
  inputClassName = "",
  showPasswordToggle = false,
  rightIcon,
  style,
  inputRef,
  required = false,
  testID,
}) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const colors = useThemeColors();

  const handlePasswordToggle = () => {
    setIsPasswordVisible(!isPasswordVisible);
  };

  const actualSecureTextEntry = showPasswordToggle
    ? !isPasswordVisible
    : secureTextEntry;

  return (
    <View className={className}>
      {label && (
        <Text className="text-ink-soft font-medium mb-2">
          {label}
          {required && <Text className="text-destructive"> *</Text>}
        </Text>
      )}

      <View className="relative">
        <TextInput
          ref={inputRef}
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          onBlur={() => {
            setIsFocused(false);
            onBlur?.();
          }}
          onFocus={() => setIsFocused(true)}
          placeholder={placeholder}
          secureTextEntry={actualSecureTextEntry}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          multiline={multiline}
          numberOfLines={numberOfLines}
          editable={editable}
          className={cn(
            "border rounded-lg px-3 py-3 text-base",
            inputFieldStateClasses({ focused: isFocused, error: Boolean(error), editable }),
            multiline && "min-h-[100px] text-top",
            showPasswordToggle || rightIcon ? "pr-12" : "",
            inputClassName,
          )}
          textAlignVertical="center"
          // `muted` reaches 4.5:1 on the field in both themes (theme-tokens test).
          placeholderTextColor={placeholderTextColor ?? colors.muted}
          selectionColor={colors.primary}
          style={style}
        />

        {showPasswordToggle && (
          <TouchableOpacity
            onPress={handlePasswordToggle}
            accessibilityRole="button"
            accessibilityLabel={isPasswordVisible ? "Ocultar senha" : "Mostrar senha"}
            className="absolute right-3 top-3 p-1"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={isPasswordVisible ? "eye-off" : "eye"}
              size={20}
              color={colors.muted}
            />
          </TouchableOpacity>
        )}

        {!showPasswordToggle && rightIcon && (
          <View
            className="absolute right-3"
            style={{
              top: "50%",
              transform: [{ translateY: -12 }],
            }}
          >
            {rightIcon}
          </View>
        )}
      </View>

      {error && <Text className="text-destructive text-sm mt-1">{error}</Text>}
    </View>
  );
};
