import React, { useState, useRef, useEffect } from "react";

import { View, Text, TextInput, TouchableOpacity } from "react-native";
import { cn } from "../../utils/cn";

interface TwoFactorInputProps {
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export const TwoFactorInput: React.FC<TwoFactorInputProps> = ({
  value,
  onChangeText,
  error,
  disabled = false,
  className = "",
}) => {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Ensure we always have 6 characters by filling in empty spaces
  const digits = (value + "      ").slice(0, 6).split("");

  useEffect(() => {
    // Auto-focus first input only if there is no value
    if (inputRefs.current[0] && value.length === 0) {
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
    }
  }, []);

  // Function to determine whether an input should be enabled
  const isInputEnabled = (index: number): boolean => {
    if (disabled) return false;

    // Function to determine whether an input should be enabled
    if (index === 0) return true;

    // The other inputs are only enabled if all the previous ones are filled in.
    for (let i = 0; i < index; i++) {
      if (!digits[i] || digits[i] === " ") {
        return false;
      }
    }

    return true;
  };

  // Function to find the next empty field
  const getNextEmptyIndex = (): number => {
    for (let i = 0; i < 6; i++) {
      if (!digits[i] || digits[i] === " ") {
        return i;
      }
    }

    return 5; // If all are filled, return the last one
  };

  const handleDigitChange = (text: string, index: number) => {
    // Only numbers are allowed
    const numericText = text.replace(/[^0-9]/g, "");

    // If the input should not be enabled, redirect to the first empty one
    if (!isInputEnabled(index)) {
      const nextEmptyIndex = getNextEmptyIndex();
      if (numericText && inputRefs.current[nextEmptyIndex]) {
        const newDigits = [...digits];
        newDigits[nextEmptyIndex] = numericText;

        const newValue = newDigits.join("").trim();
        onChangeText(newValue);

        // Focus on the next field if it is not the last one
        if (nextEmptyIndex < 5) {
          setTimeout(() => {
            inputRefs.current[nextEmptyIndex + 1]?.focus();
          }, 50);
        }
      }

      return;
    }

    if (numericText.length <= 1) {
      const newDigits = [...digits];
      newDigits[index] = numericText || " ";

      // Clear all fields on the right if we are changing a field in the middle
      for (let i = index + 1; i < 6; i++) {
        if (numericText === "") {
          newDigits[i] = " ";
        }
      }

      const newValue = newDigits.join("").trim();
      onChangeText(newValue);

      // Auto-focus next input if a digit was entered and it is not the last
      if (numericText && index < 5 && isInputEnabled(index + 1)) {
        setTimeout(() => {
          inputRefs.current[index + 1]?.focus();
        }, 50);
      }
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === "Backspace") {
      const currentValue = digits[index];

      if (!currentValue || currentValue === " ") {
        // If the current field is empty, move to the previous one
        if (index > 0) {
          setTimeout(() => {
            inputRefs.current[index - 1]?.focus();
          }, 50);
        }
      } else {
        // If the current field has a value, clear it and all subsequent ones
        const newDigits = [...digits];

        for (let i = index; i < 6; i++) {
          newDigits[i] = " ";
        }

        const newValue = newDigits.join("").trim();
        onChangeText(newValue);
      }
    }
  };

  const handleInputPress = (index: number) => {
    if (!disabled) {
      // If the input should not be enabled, redirect to the first empty one
      if (!isInputEnabled(index)) {
        const nextEmptyIndex = getNextEmptyIndex();

        if (inputRefs.current[nextEmptyIndex]) {
          inputRefs.current[nextEmptyIndex]?.focus();
        }
      } else if (inputRefs.current[index]) {
        inputRefs.current[index]?.focus();
      }
    }
  };

  return (
    <View className={className}>
      <View className="flex-row justify-center items-center">
        {/* First group of 3 digits */}
        <View className="flex-row" style={{ gap: 8 }}>
          {digits.slice(0, 3).map((digit, index) => {
            const isEnabled = isInputEnabled(index);
            return (
              <TouchableOpacity
                key={index}
                onPress={() => handleInputPress(index)}
                disabled={disabled}
              >
                <View
                  className={cn(
                    "w-12 h-12 border-2 rounded-lg justify-center items-center",
                    focusedIndex === index
                      ? "border-blue-500 bg-blue-50"
                      : error
                      ? "border-red-500 bg-red-50"
                      : isEnabled
                      ? "border-gray-300 bg-white"
                      : "border-gray-200 bg-gray-100",
                    disabled && "bg-gray-100"
                  )}
                >
                  <TextInput
                    ref={(ref) => {
                      inputRefs.current[index] = ref;
                    }}
                    value={digit === " " ? "" : digit}
                    onChangeText={(text) => handleDigitChange(text, index)}
                    onKeyPress={({ nativeEvent }) =>
                      handleKeyPress(index, nativeEvent.key)
                    }
                    onFocus={() => setFocusedIndex(index)}
                    onBlur={() => setFocusedIndex(null)}
                    keyboardType="number-pad"
                    maxLength={1}
                    editable={!disabled && isEnabled}
                    selectTextOnFocus
                    style={{
                      width: "100%",
                      height: "100%",
                      textAlign: "center",
                      fontSize: 18,
                      fontWeight: "600",
                      color: isEnabled ? "#111827" : "#9ca3af",
                    }}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Separator */}
        <View
          className="bg-gray-400 mx-4"
          style={{
            width: 12,
            height: 2,
          }}
        />

        {/* Second group of 3 digits */}
        <View className="flex-row" style={{ gap: 8 }}>
          {digits.slice(3, 6).map((digit, index) => {
            const actualIndex = index + 3;
            const isEnabled = isInputEnabled(actualIndex);

            return (
              <TouchableOpacity
                key={actualIndex}
                onPress={() => handleInputPress(actualIndex)}
                disabled={disabled}
              >
                <View
                  className={cn(
                    "w-12 h-12 border-2 rounded-lg justify-center items-center",
                    focusedIndex === actualIndex
                      ? "border-blue-500 bg-blue-50"
                      : error
                      ? "border-red-500 bg-red-50"
                      : isEnabled
                      ? "border-gray-300 bg-white"
                      : "border-gray-200 bg-gray-100",
                    disabled && "bg-gray-100"
                  )}
                >
                  <TextInput
                    ref={(ref) => {
                      inputRefs.current[actualIndex] = ref;
                    }}
                    value={digit === " " ? "" : digit}
                    onChangeText={(text) =>
                      handleDigitChange(text, actualIndex)
                    }
                    onKeyPress={({ nativeEvent }) =>
                      handleKeyPress(actualIndex, nativeEvent.key)
                    }
                    onFocus={() => setFocusedIndex(actualIndex)}
                    onBlur={() => setFocusedIndex(null)}
                    keyboardType="number-pad"
                    maxLength={1}
                    editable={!disabled && isEnabled}
                    selectTextOnFocus
                    style={{
                      width: "100%",
                      height: "100%",
                      textAlign: "center",
                      fontSize: 18,
                      fontWeight: "600",
                      color: isEnabled ? "#111827" : "#9ca3af",
                    }}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {error && (
        <Text
          style={{
            color: "#dc2626",
            fontSize: 14,
            marginTop: 8,
            textAlign: "center",
          }}
        >
          {error}
        </Text>
      )}
    </View>
  );
};
