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
      <View className="bg-card border border-border rounded-2xl p-4 flex-1 mr-2">
        <Text className="text-xs font-medium text-muted mb-1">Total</Text>
        <Text className="text-xl font-bold text-ink">{total || 0}</Text>
        <Text className="text-xs text-muted">veículos</Text>
      </View>
      <View className="bg-card border border-border rounded-2xl p-4 flex-1 ml-2">
        <Text className="text-xs font-medium text-muted mb-1">Status</Text>
        <Text className="text-xl font-bold text-ink">
          {activeCount}{" "}
          <Text className="animate-pulse text-success text-sm">●</Text>
        </Text>
        <Text className="text-xs text-muted">ativos</Text>
      </View>
    </View>
  );
};
