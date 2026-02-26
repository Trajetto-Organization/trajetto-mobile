import { useState } from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";

import DateTimePicker from "@react-native-community/datetimepicker";
import { cn } from "../../utils/cn";

interface DatePickerProps {
  label?: string;
  value?: Date;
  onDateChange?: (date: Date) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  maximumDate?: Date;
  minimumDate?: Date;
  required?: boolean;
}

export const DatePicker: React.FC<DatePickerProps> = ({
  label,
  value,
  onDateChange,
  error,
  disabled = false,
  className = "",
  placeholder = "Selecione uma data",
  maximumDate,
  minimumDate,
  required = false,
}) => {
  const [showPicker, setShowPicker] = useState<boolean>(false);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const handleDateChange = (_: any, selectedDate?: Date) => {
    setShowPicker(Platform.OS === "ios");

    if (selectedDate) {
      onDateChange?.(selectedDate);
    }
  };

  const showDatePicker = () => {
    if (!disabled) {
      setShowPicker(true);
    }
  };

  return (
    <View className={className}>
      {label && (
        <Text className="text-gray-700 font-medium mb-2">
          {label}
          {required && <Text className="text-red-500"> *</Text>}
        </Text>
      )}

      <TouchableOpacity
        onPress={showDatePicker}
        disabled={disabled}
        className={cn(
          "border rounded-lg px-3 py-3 bg-white flex-row justify-between items-center",
          error ? "border-danger-500" : "border-gray-300",
          disabled && "bg-gray-100 opacity-60",
        )}
      >
        <Text
          className={cn("text-base", value ? "text-gray-900" : "text-gray-500")}
        >
          {value ? formatDate(value) : placeholder}
        </Text>
        <Text className="text-gray-400 text-lg">📅</Text>
      </TouchableOpacity>

      {error && <Text className="text-danger-600 text-sm mt-1">{error}</Text>}

      {showPicker && (
        <DateTimePicker
          value={value || new Date()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleDateChange}
          maximumDate={maximumDate}
          minimumDate={minimumDate}
        />
      )}
    </View>
  );
};
