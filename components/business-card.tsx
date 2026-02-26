import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Business } from "../hooks/use-business-infinite-scroll";

import { formatCnpj, formatTelephone } from "../utils/formatters";

interface BusinessCardProps {
  business: Business;
  onPress?: () => void;
  isSelecting?: boolean;
  disabled?: boolean;
}

export const BusinessCard: React.FC<BusinessCardProps> = ({
  business,
  onPress,
  isSelecting = false,
  disabled = false,
}) => {
  // Safety check - if business is null or undefined, don't render
  if (!business) {
    return null;
  }

  // Safe string formatter to ensure we never render undefined/null
  const safeString = (value: any) => {
    if (value === null || value === undefined) return "N/A";
    return String(value);
  };

  const handleCardPress = () => {
    if (onPress && !disabled && !isSelecting) {
      onPress();
    }
  };

  return (
    <Pressable
      onPress={handleCardPress}
      disabled={disabled || isSelecting}
      style={({ pressed }) => ({
        opacity: pressed && !isSelecting && !disabled ? 0.7 : 1,
      })}
      className={`bg-white rounded-lg shadow-sm p-4 mb-3 mx-4 ${
        isSelecting
          ? "border-2 border-primary-500"
          : disabled
            ? "border border-gray-200 opacity-40"
            : "border border-gray-200"
      }`}
    >
      {/* Header: Corporate Reason and Fantasy Name */}
      <View className="mb-3">
        <Text className="text-lg font-bold text-gray-900" numberOfLines={1}>
          {safeString(business.corporate_reason)}
        </Text>
        {business.fantasy_name && (
          <Text className="text-sm text-gray-600" numberOfLines={1}>
            {safeString(business.fantasy_name)}
          </Text>
        )}
        <Text className="text-sm text-gray-600 mt-1">
          CNPJ: {safeString(formatCnpj(business.cnpj))}
        </Text>
      </View>

      {/* Contact Information */}
      <View
        className="flex-row justify-between 
        items-center mb-3"
      >
        <View className="flex-1">
          <Text
            className="text-xs text-gray-500 
            uppercase tracking-wide mb-1"
          >
            E-mail
          </Text>
          <Text
            className="text-sm text-gray-700"
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {safeString(business.email)}
          </Text>
        </View>
        <View className="ml-4">
          <Text
            className="text-xs text-gray-500 
            uppercase tracking-wide mb-1"
          >
            Telefone
          </Text>
          <Text className="text-sm text-gray-700">
            {safeString(formatTelephone(business.telephone))}
          </Text>
        </View>
      </View>

      {/* Location Information */}
      <View className="mb-3">
        <Text
          className="text-xs text-gray-500 
          uppercase tracking-wide mb-1"
        >
          Localização
        </Text>
        <Text
          className="text-sm text-gray-700"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {business.city}, {business.uf} - CEP: {business.cep}
        </Text>
        <Text
          className="text-xs text-gray-500 mt-1"
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {business.street}, {business.address_number}
          {business.complement && `, ${business.complement}`}
        </Text>
      </View>

      {/* Additional Information */}
      <View className="flex-row justify-between items-center mb-3">
        <View className="flex-1">
          <Text
            className="text-xs text-gray-500 
            uppercase tracking-wide mb-1"
          >
            Responsável
          </Text>
          <Text
            className="text-sm text-gray-700"
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {safeString(business.responsible_name)}
          </Text>
        </View>
        {business.erp_code && (
          <View className="ml-4">
            <Text
              className="text-xs text-gray-500 
              uppercase tracking-wide mb-1"
            >
              Cód. ERP
            </Text>
            <Text className="text-sm text-gray-700">
              {safeString(business.erp_code)}
            </Text>
          </View>
        )}
      </View>

      {/* Selection Hint */}
      <View className="mt-3 pt-3 border-t border-gray-100">
        {isSelecting ? (
          <View className="flex-row items-center justify-center gap-2">
            <ActivityIndicator size="small" color="#3b82f6" />
            <Text className="text-center text-primary-600 text-sm font-medium">
              Selecionando...
            </Text>
          </View>
        ) : (
          <Text
            className="text-center text-primary-600
            text-sm font-medium"
          >
            Toque para selecionar empresa 🏢
          </Text>
        )}
      </View>
    </Pressable>
  );
};
