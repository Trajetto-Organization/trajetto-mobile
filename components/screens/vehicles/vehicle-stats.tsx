import { View, Text } from "react-native";

interface VehicleStatsProps {
  total: number;
  activeCount: number;
}

export const VehicleStats: React.FC<VehicleStatsProps> = ({
  total,
  activeCount,
}) => {
  return (
    <View className="flex-row justify-between mt-4 -mb-4">
      <View className="bg-red-50 rounded-2xl p-4 flex-1 mr-2">
        <Text className="text-xs font-medium mb-1">Total</Text>
        <Text className="text-xl font-bold">{total || 0}</Text>
        <Text className="text-xs">veículos</Text>
      </View>
      <View className="bg-red-50 rounded-2xl p-4 flex-1 ml-2">
        <Text className="text-xs font-medium mb-1">Status</Text>
        <Text className="text-xl font-bold">
          {activeCount}{" "}
          <Text className="animate-pulse text-green-400 text-sm">●</Text>
        </Text>
        <Text className="text-xs">ativos</Text>
      </View>
    </View>
  );
};
