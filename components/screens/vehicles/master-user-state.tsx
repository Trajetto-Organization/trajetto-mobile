import { View, Text, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../../ui";

interface MasterUserStateProps {
  onSelectBusiness: () => void;
  onLogout: () => void;
}

export const MasterUserState: React.FC<MasterUserStateProps> = ({
  onSelectBusiness,
  onLogout,
}) => {
  return (
    <SafeAreaView
      className="flex-1 bg-gradient-to-br
      from-primary-50 to-white"
    >
      <View className="flex-1 justify-center items-center px-8">
        {/* Header illustration */}
        <View className="relative mb-8">
          <View
            className="w-32 h-32 bg-gradient-to-br from-primary-500
            to-primary-600 rounded-3xl items-center justify-center shadow-xl"
          >
            <Text className="text-6xl">🏢</Text>
          </View>
          <View
            className="absolute -top-2 -right-2 w-8 h-8 bg-yellow-400
            rounded-full items-center justify-center"
          >
            <Text className="text-white text-xs font-bold">👑</Text>
          </View>
        </View>

        <Text
          className="text-3xl font-bold
          text-gray-900 mb-3 text-center"
        >
          Olá, Master! 👋
        </Text>
        <Text
          className="text-gray-600 text-center
          mb-8 text-base leading-6 max-w-sm"
        >
          Para começar a gerenciar a frota, você precisa primeiro selecionar uma
          empresa.
        </Text>

        {/* Action buttons */}
        <View className="w-full max-w-sm">
          <Button onPress={onSelectBusiness} className="mb-4 shadow-lg">
            🏢 Selecionar Empresa
          </Button>
          <TouchableOpacity onPress={onLogout} className="py-3">
            <Text className="text-gray-500 text-center font-medium">
              ← Sair da conta
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};
