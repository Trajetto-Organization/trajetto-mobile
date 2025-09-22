import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Input } from "../../ui";

interface BusinessSearchProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClearSearch: () => void;
  debouncedSearch: string;
  isFetching: boolean;
  businessesCount: number;
}

export const BusinessSearch: React.FC<BusinessSearchProps> = ({
  searchQuery,
  onSearchChange,
  onClearSearch,
  debouncedSearch,
  isFetching,
  businessesCount,
}) => {
  const hasSearchResults = Boolean(
    debouncedSearch && debouncedSearch.length > 0
  );

  return (
    <View className="mt-6 mb-2">
      <Input
        value={searchQuery}
        onChangeText={onSearchChange}
        placeholder="Buscar empresa por nome ou CNPJ..."
        placeholderTextColor="#9ca3af"
        className="bg-white/90 backdrop-blur-sm
        border-gray-200 rounded-2xl shadow-sm"
        style={{
          fontSize: 16,
          paddingHorizontal: 20,
          paddingVertical: 16,
        }}
        rightIcon={
          searchQuery.length > 0 ? (
            <TouchableOpacity
              onPress={onClearSearch}
              className="p-1 rounded-full bg-gray-100"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={18} color="#6b7280" />
            </TouchableOpacity>
          ) : (
            <View className="p-1">
              <Ionicons name="search" size={18} color="#9ca3af" />
            </View>
          )
        }
      />
      {hasSearchResults && (
        <Text
          className="text-xs text-gray-500 mt-2 ml-4"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {isFetching
            ? "Buscando..."
            : `${businessesCount} resultado${
                businessesCount !== 1 ? "s" : ""
              } para "${
                debouncedSearch.length > 20
                  ? debouncedSearch.substring(0, 20) + "..."
                  : debouncedSearch
              }"`}
        </Text>
      )}
    </View>
  );
};
