import { View, Text } from "react-native";
import { formatTotalAmount } from "../../utils/formatters";

interface TotalAmountDisplayProps {
  amount: number;
  className?: string;
}

export const TotalAmountDisplay: React.FC<TotalAmountDisplayProps> = ({
  amount,
  className = "",
}) => {
  return (
    <View className={`mb-6 ${className}`}>
      <Text className="text-ink-soft font-medium mb-3">Valor Total</Text>

      <View className="bg-success-soft rounded-2xl p-6 border-2 border-success/30">
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text
              className="text-xs text-success 
              font-medium mb-2 uppercase tracking-wider"
            >
              Total do Abastecimento
            </Text>
            <Text className="text-3xl font-bold text-success">
              {formatTotalAmount(amount)}
            </Text>
          </View>

          {/* Decorative icon */}
          <View
            className="w-12 h-12 bg-card 
            rounded-full items-center justify-center"
          >
            <Text className="text-2xl">💰</Text>
          </View>
        </View>

        {/* Additional information */}
        <View className="mt-4 pt-4 border-t border-success/20">
          <Text className="text-xs text-success text-center">
            💡 Valor calculado automaticamente (litros × preço)
          </Text>
        </View>
      </View>
    </View>
  );
};
