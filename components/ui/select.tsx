import { useState } from "react";

import { View, Text, TouchableOpacity, Modal, FlatList } from "react-native";
import { cn } from "../../utils/cn";

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  error?: string;
  disabled?: boolean;
  className?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  placeholder = "Selecione uma opção",
  value,
  onValueChange,
  options,
  error,
  disabled = false,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption = options.find((option) => option.value === value);

  const handleSelect = (optionValue: string) => {
    onValueChange?.(optionValue);
    setIsOpen(false);
  };

  const renderOption = ({ item }: { item: SelectOption }) => (
    <TouchableOpacity
      onPress={() => handleSelect(item.value)}
      className={cn(
        "px-4 py-4 border-b border-gray-100",
        item.value === value && "bg-primary-50"
      )}
    >
      <Text
        className={cn(
          "text-base",
          item.value === value
            ? "text-primary-600 font-medium"
            : "text-gray-900"
        )}
      >
        {item.label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View className={className}>
      {label && (
        <Text
          className="text-gray-700 
          font-medium mb-2"
        >
          {label}
        </Text>
      )}

      <TouchableOpacity
        onPress={() => !disabled && setIsOpen(true)}
        disabled={disabled}
        className={cn(
          "border rounded-lg px-3 py-3 bg-white flex-row justify-between items-center",
          error ? "border-danger-500" : "border-gray-300",
          disabled && "bg-gray-100 opacity-60"
        )}
      >
        <Text
          className={cn(
            "text-base",
            selectedOption ? "text-gray-900" : "text-gray-500"
          )}
        >
          {selectedOption?.label || placeholder}
        </Text>
        <Text className="text-gray-400 text-lg">{isOpen ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {error && <Text className="text-danger-600 text-sm mt-1">{error}</Text>}

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setIsOpen(false)}
          className="flex-1 bg-black/50 
          justify-center px-4"
        >
          <TouchableOpacity
            activeOpacity={1}
            className="bg-white rounded-lg 
            max-h-96 overflow-hidden"
          >
            {/* Header */}
            <View
              className="px-4 py-3 border-b 
              border-gray-200 bg-gray-50"
            >
              <Text className="font-medium text-gray-900">
                {label || "Selecionar opção"}
              </Text>
            </View>

            {/* Options List */}
            <FlatList
              data={options}
              renderItem={renderOption}
              keyExtractor={(item) => item.value}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View className="px-4 py-8">
                  <Text className="text-center text-gray-500">
                    Nenhuma opção disponível
                  </Text>
                </View>
              }
            />

            {/* Cancel Button */}
            <TouchableOpacity
              onPress={() => setIsOpen(false)}
              className="px-4 py-3 border-t 
              border-gray-200 bg-gray-50"
            >
              <Text
                className="text-center 
                text-gray-600 font-medium"
              >
                Cancelar
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};
