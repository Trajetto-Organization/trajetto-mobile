import React from "react";

import { TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Input } from "../ui";

interface SearchWithDebounceProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  className?: string;
}

export const SearchWithDebounce: React.FC<SearchWithDebounceProps> = ({
  value,
  onChangeText,
  placeholder = "Buscar...",
  className,
}) => {
  return (
    <Input
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      className={className || "bg-white border-gray-200 rounded-2xl"}
      rightIcon={
        value.length > 0 ? (
          <TouchableOpacity onPress={() => onChangeText("")}>
            <Ionicons name="close" size={18} color="#6b7280" />
          </TouchableOpacity>
        ) : (
          <Ionicons name="search" size={18} color="#9ca3af" />
        )
      }
    />
  );
};
