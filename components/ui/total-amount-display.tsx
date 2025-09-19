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
      <Text className="text-gray-700 font-medium mb-3">Valor Total</Text>

      {/* Card do valor total */}
      <View
        className="bg-gradient-to-r from-green-50 to-emerald-50 
        rounded-2xl p-6 border-2 border-green-200/60 "
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text
              className="text-xs text-green-600 
              font-medium mb-2 uppercase tracking-wider"
            >
              Total do Abastecimento
            </Text>
            <Text className="text-3xl font-bold text-green-700">
              {formatTotalAmount(amount)}
            </Text>
          </View>

          {/* Decorative icon */}
          <View
            className="w-12 h-12 bg-green-100 
            rounded-full items-center justify-center"
          >
            <Text className="text-2xl">💰</Text>
          </View>
        </View>

        {/* Additional information */}
        <View className="mt-4 pt-4 border-t border-green-200/40">
          <Text className="text-xs text-green-600 text-center">
            💡 Valor calculado automaticamente (litros × preço)
          </Text>
        </View>
      </View>
    </View>
  );
};
