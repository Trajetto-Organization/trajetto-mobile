import { View, Text, TouchableOpacity } from "react-native";
import { Business } from "../hooks/use-business-infinite-scroll";

interface BusinessCardProps {
  business: Business;
  onPress?: () => void;
}

// Removed status functions since Business doesn't have status
export const BusinessCard: React.FC<BusinessCardProps> = ({
  business,
  onPress,
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
    if (onPress) {
      onPress();
    }
  };

  return (
    <TouchableOpacity
      onPress={handleCardPress}
      activeOpacity={0.7}
      className="bg-white rounded-lg shadow-sm 
      border border-gray-200 p-4 mb-3 mx-4"
    >
      {/* Header: Corporate Reason and Fantasy Name */}
      <View className="mb-3">
        <Text className="text-lg font-bold text-gray-900" numberOfLines={1}>
          {safeString(business.corporate_reason)}
        </Text>
        {business.fantasy_name && business.fantasy_name !== "N/A" && (
          <Text className="text-sm text-gray-600" numberOfLines={1}>
            {safeString(business.fantasy_name)}
          </Text>
        )}
        <Text className="text-sm text-gray-600 mt-1">
          CNPJ: {safeString(business.cnpj)}
        </Text>
      </View>

      {/* Contact Information */}
      <View className="flex-row justify-between items-center mb-3">
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
            {safeString(business.telephone)}
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
          {business.complement &&
            business.complement !== "N/A" &&
            `, ${business.complement}`}
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
        {business.erp_code && business.erp_code !== "N/A" && (
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
        <Text
          className="text-center text-primary-600 
          text-sm font-medium"
        >
          Toque para selecionar empresa 🏢
        </Text>
      </View>
    </TouchableOpacity>
  );
};
