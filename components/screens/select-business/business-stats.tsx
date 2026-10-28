import { View, Text } from "react-native";

interface BusinessStatsProps {
  total: number;
}

export const BusinessStats: React.FC<BusinessStatsProps> = ({ total }) => {
  return (
    <View className="mt-4 -mb-4">
      <View
        className="bg-primary rounded-2xl 
        px-5 py-3 flex-row items-center justify-between shadow-lg"
      >
        <View className="flex-1">
          {/* Full foreground, no tint: a lighter blue label fell under
              4.5:1 on the brand surface. */}
          <Text
            className="text-xs font-medium 
            text-primary-foreground uppercase tracking-wider"
          >
            Total de Empresas
          </Text>
          <Text className="text-2xl font-bold text-primary-foreground mt-1">
            {total}
          </Text>
        </View>
        <View
          className="w-12 h-12 bg-primary-foreground/20 
          rounded-2xl items-center justify-center"
        >
          <Text className="text-xl">🏢</Text>
        </View>
      </View>
    </View>
  );
};
