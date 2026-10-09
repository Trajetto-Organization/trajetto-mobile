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
  required?: boolean;
  /** Maestro handle (docs/testes.md, Maestro section): the field, and `<testID>-option` on each option. */
  testID?: string;
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
  required = false,
  testID,
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
      testID={testID ? `${testID}-option` : undefined}
      accessibilityRole="button"
      accessibilityState={{ selected: item.value === value }}
      className={cn(
        "px-4 py-4 border-b border-border",
        item.value === value && "bg-primary-soft",
      )}
    >
      <Text
        className={cn(
          "text-base",
          item.value === value
            ? "text-primary font-medium"
            : "text-ink",
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
          className="text-ink-soft
          font-medium mb-2"
        >
          {label}
          {required && <Text className="text-destructive"> *</Text>}
        </Text>
      )}

      <TouchableOpacity
        onPress={() => !disabled && setIsOpen(true)}
        disabled={disabled}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: isOpen }}
        className={cn(
          "border rounded-lg px-3 py-3 bg-card flex-row justify-between items-center",
          error ? "border-destructive" : "border-input",
          disabled && "bg-subtle opacity-60",
        )}
      >
        <Text
          className={cn(
            "text-base",
            selectedOption ? "text-ink" : "text-muted",
          )}
        >
          {selectedOption?.label || placeholder}
        </Text>
        <Text className="text-muted text-lg">{isOpen ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {error && <Text className="text-destructive text-sm mt-1">{error}</Text>}

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
            className="bg-card rounded-lg 
            max-h-96 overflow-hidden"
          >
            {/* Header */}
            <View
              className="px-4 py-3 border-b 
              border-border bg-subtle"
            >
              <Text className="font-medium text-ink">
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
                  <Text className="text-center text-muted">
                    Nenhuma opção disponível
                  </Text>
                </View>
              }
            />

            {/* Cancel Button */}
            <TouchableOpacity
              onPress={() => setIsOpen(false)}
              className="px-4 py-3 border-t 
              border-border bg-subtle"
            >
              <Text
                className="text-center 
                text-muted font-medium"
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
