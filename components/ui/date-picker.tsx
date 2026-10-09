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
        <Text className="text-ink-soft font-medium mb-2">
          {label}
          {required && <Text className="text-destructive"> *</Text>}
        </Text>
      )}

      <TouchableOpacity
        onPress={showDatePicker}
        disabled={disabled}
        className={cn(
          "border rounded-lg px-3 py-3 bg-card flex-row justify-between items-center",
          error ? "border-destructive" : "border-input",
          disabled && "bg-subtle opacity-60",
        )}
      >
        <Text
          className={cn("text-base", value ? "text-ink" : "text-muted")}
        >
          {value ? formatDate(value) : placeholder}
        </Text>
        <Text className="text-muted text-lg">📅</Text>
      </TouchableOpacity>

      {error && <Text className="text-destructive text-sm mt-1">{error}</Text>}

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
