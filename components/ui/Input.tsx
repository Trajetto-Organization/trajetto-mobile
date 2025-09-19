import { useState } from "react";

import { TextInput, View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { cn } from "../../utils/cn";

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
}

export const Input: React.FC<InputProps> = ({
  label,
  placeholder,
  placeholderTextColor = "#9ca3af",
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
}) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState<boolean>(false);
  const [isFocused, setIsFocused] = useState<boolean>(false);

  const handlePasswordToggle = () => {
    setIsPasswordVisible(!isPasswordVisible);
  };

  const actualSecureTextEntry = showPasswordToggle
    ? !isPasswordVisible
    : secureTextEntry;

  return (
    <View className={className}>
      {label && <Text className="text-gray-700 font-medium mb-2">{label}</Text>}

      <View className="relative">
        <TextInput
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
            "border rounded-lg px-3 py-3 text-gray-900 text-base",
            isFocused
              ? "border-primary-500 bg-white"
              : "border-gray-300 bg-gray-50",
            error && "border-danger-500 bg-danger-50",
            !editable && "bg-gray-100 text-gray-500",
            multiline && "min-h-[100px] text-top",
            showPasswordToggle || rightIcon ? "pr-12" : "",
            inputClassName
          )}
          textAlignVertical="center"
          placeholderTextColor={placeholderTextColor}
          style={style}
        />

        {showPasswordToggle && (
          <TouchableOpacity
            onPress={handlePasswordToggle}
            className="absolute right-3 top-3 p-1"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={isPasswordVisible ? "eye-off" : "eye"}
              size={20}
              color="#6b7280"
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

      {error && <Text className="text-danger-600 text-sm mt-1">{error}</Text>}
    </View>
  );
};
