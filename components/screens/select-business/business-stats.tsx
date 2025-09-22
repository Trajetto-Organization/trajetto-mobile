import { View, Text } from "react-native";

interface BusinessStatsProps {
  total: number;
}

export const BusinessStats: React.FC<BusinessStatsProps> = ({ total }) => {
  return (
    <View className="flex-row justify-center mt-4 -mb-4">
      <View className="bg-blue-50 rounded-2xl p-4 flex-1 max-w-xs">
        <Text className="text-xs font-medium mb-1 text-center">
          Total de Empresas
        </Text>
        <Text className="text-xl font-bold text-center">{total}</Text>
      </View>
    </View>
  );
};
