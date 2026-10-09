import { View, Text } from "react-native";
import { Button } from "../../ui";

interface VehicleErrorStateProps {
  error?: string;
  isRefreshingError: boolean;
  onRetry: () => void;
}

export const VehicleErrorState: React.FC<VehicleErrorStateProps> = ({
  error,
  isRefreshingError,
  onRetry,
}) => {
  return (
    <View
      className="mx-6 mt-4 bg-card rounded-2xl
      border border-destructive/40 shadow-sm overflow-hidden"
    >
      <View
        className="bg-destructive px-4 py-3"
      >
        <View className="flex-row items-center">
          <View
            className="w-8 h-8 bg-destructive-foreground/20
            rounded-full items-center justify-center mr-3"
          >
            <Text className="text-destructive-foreground font-bold">⚠️</Text>
          </View>
          <Text className="text-destructive-foreground font-bold text-base">
            Oops! Algo deu errado
          </Text>
        </View>
      </View>
      <View className="p-4">
        <Text className="text-muted text-sm mb-4 leading-5">
          {error ||
            "Não foi possível carregar os veículos. Verifique sua conexão e tente novamente."}
        </Text>
        <Button
          onPress={onRetry}
          variant="danger"
          size="sm"
          loading={isRefreshingError}
          disabled={isRefreshingError}
          className="shadow-sm"
        >
          {isRefreshingError ? "Tentando..." : "🔄 Tentar novamente"}
        </Button>
      </View>
    </View>
  );
};
