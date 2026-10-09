import { View, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Input } from "../../ui";
import { useThemeColors } from "@/hooks/use-theme";

interface VehicleSearchProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClearSearch: () => void;
  debouncedSearch: string;
  isFetching: boolean;
  vehiclesCount: number;
}

export const VehicleSearch: React.FC<VehicleSearchProps> = ({
  searchQuery,
  onSearchChange,
  onClearSearch,
  debouncedSearch,
  isFetching,
  vehiclesCount,
}) => {
  const hasSearchResults = debouncedSearch && debouncedSearch.length > 0;
  const colors = useThemeColors();

  return (
    <View className="mt-6 mb-2">
      <Input
        value={searchQuery}
        onChangeText={onSearchChange}
        placeholder="Buscar veículo por placa, modelo..."
        placeholderTextColor={colors.muted}
        // The field paints its own themed surface; a white wrapper here
        // showed as a light halo around it in the dark theme.
        className="rounded-2xl"
        style={{
          fontSize: 16,
          paddingHorizontal: 20,
          paddingVertical: 16,
        }}
        rightIcon={
          searchQuery.length > 0 ? (
            <TouchableOpacity
              onPress={onClearSearch}
              className="p-1 rounded-full bg-subtle"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={18} color={colors.muted} />
            </TouchableOpacity>
          ) : (
            <View className="p-1">
              <Ionicons name="search" size={18} color={colors.muted} />
            </View>
          )
        }
      />
      {hasSearchResults && (
        <Text
          className="text-xs text-muted mt-2 ml-4"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {isFetching
            ? "Buscando..."
            : `${vehiclesCount} resultado${
                vehiclesCount !== 1 ? "s" : ""
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
