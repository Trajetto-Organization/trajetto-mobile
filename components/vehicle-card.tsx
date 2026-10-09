import { View, Text, TouchableOpacity } from "react-native";
import { Vehicle } from "../types";

interface VehicleCardProps {
  vehicle: Vehicle;
  hasActionPermission: boolean;
  onPress?: () => void;
}

// Background and text apart: a text colour on the badge's View never reaches
// its Text in React Native, so the label used to render in the default black.
const getStatusColor = (status: Vehicle["status"]): { badge: string; label: string } => {
  switch (status) {
    case "ACTIVE":
      return { badge: "bg-success-soft", label: "text-success" };
    case "IN_ROUTE":
      return { badge: "bg-primary-soft", label: "text-primary" };
    case "BLOCKED":
      return { badge: "bg-destructive-soft", label: "text-destructive" };
    case "INACTIVE":
    default:
      return { badge: "bg-subtle", label: "text-ink-soft" };
  }
};

const getStatusText = (status: Vehicle["status"]) => {
  switch (status) {
    case "ACTIVE":
      return "Ativo";
    case "IN_ROUTE":
      return "Em Rota";
    case "INACTIVE":
      return "Inativo";
    case "BLOCKED":
      return "Bloqueado";
    default:
      return "Desconhecido";
  }
};

export const VehicleCard: React.FC<VehicleCardProps> = ({
  vehicle,
  hasActionPermission,
  onPress,
}) => {
  // Safety check - if vehicle is null or undefined, don't render
  if (!vehicle) {
    return null;
  }

  const formatMileage = (mileage: any) => {
    const numValue = Number(mileage);

    if (isNaN(numValue)) {
      return "0 km";
    }

    return numValue.toLocaleString("pt-BR") + " km";
  };

  const handleCardPress = () => {
    const isInteractable =
      vehicle.status === "ACTIVE" || vehicle.status === "IN_ROUTE";

    if (onPress && isInteractable && hasActionPermission) {
      onPress();
    }
  };

  // Helper function to extract year from date string
  const getYearFromDate = (dateString: string) => {
    if (!dateString) return "N/A";

    try {
      const year = new Date(dateString).getFullYear();
      return isNaN(year) ? "N/A" : year.toString();
    } catch {
      return "N/A";
    }
  };

  // Safe string formatter to ensure we never render undefined/null
  const safeString = (value: any) => {
    if (value === null || value === undefined) return "N/A";
    return String(value);
  };

  // Check if vehicle is disabled (INACTIVE or BLOCKED)
  const isStatusDisabled =
    vehicle.status === "INACTIVE" || vehicle.status === "BLOCKED";

  const isDisabled = isStatusDisabled || !hasActionPermission;
  const statusColor = getStatusColor(vehicle.status || "INACTIVE");

  return (
    <TouchableOpacity
      onPress={handleCardPress}
      activeOpacity={isDisabled ? 1 : 0.7}
      disabled={isDisabled}
      testID="vehicle-card"
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      className={`bg-card rounded-lg
      shadow-sm border p-4 mb-3 ${
        isDisabled ? "border-input opacity-60" : "border-border"
      }`}
    >
      {/* Header: Brand/Model and Status */}
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-ink">
            {safeString(vehicle.description)}
          </Text>
          <Text className="text-sm text-muted">
            {safeString(vehicle.brand)} • {safeString(vehicle.model)} •{" "}
            {getYearFromDate(vehicle.model_year)}
          </Text>
        </View>
        <View className={`px-3 py-1 rounded-full ${statusColor.badge}`}>
          <Text className={`text-xs font-medium ${statusColor.label}`}>
            {getStatusText(vehicle.status || "INACTIVE")}
          </Text>
        </View>
      </View>

      {/* License Plate and Renavam */}
      <View className="flex-row justify-between mb-3">
        <View>
          <Text
            className="text-xs text-muted
            uppercase tracking-wide mb-1"
          >
            Placa
          </Text>
          <Text
            className="text-base
            font-semibold text-ink"
          >
            {safeString(vehicle.license_plate)}
          </Text>
        </View>

        <View className="items-end">
          <Text
            className="text-xs text-muted
            uppercase tracking-wide mb-1"
          >
            Renavam
          </Text>
          <Text className="text-base font-semibold text-ink">
            {safeString(vehicle.renavam)}
          </Text>
        </View>
      </View>

      {/* Mileage Information */}
      <View className="flex-row justify-between items-end">
        <View>
          <Text
            className="text-xs text-muted 
            uppercase tracking-wide mb-1"
          >
            Quilometragem Atual
          </Text>
          <Text
            className="text-base 
            font-semibold text-ink"
          >
            {formatMileage(vehicle.current_mileage)}
          </Text>
        </View>

        <View className="items-end">
          <Text
            className="text-xs text-muted 
            uppercase tracking-wide mb-1"
          >
            Combustível
          </Text>
          <Text className="text-sm font-medium text-ink-soft">
            {safeString(vehicle.fuelTypeDescription)}
          </Text>
        </View>
      </View>

      {/* Maintenance Info (if available) */}
      {vehicle.last_maintenance_mileage &&
      Number(vehicle.last_maintenance_mileage) > 0 ? (
        <View className="mt-3 pt-3 border-t border-border">
          <View className="flex-row justify-between">
            <View>
              <Text
                className="text-xs text-muted 
                uppercase tracking-wide mb-1"
              >
                Última Manutenção
              </Text>
              <Text className="text-sm text-ink-soft">
                {formatMileage(vehicle.last_maintenance_mileage)}
              </Text>
            </View>
            <View className="items-end">
              <Text
                className="text-xs text-muted 
                uppercase tracking-wide mb-1"
              >
                Intervalo
              </Text>
              <Text className="text-sm text-ink-soft">
                {formatMileage(vehicle.maintenance_interval_km)}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* Action Hint */}
      {hasActionPermission &&
      !isStatusDisabled &&
      (vehicle.status === "ACTIVE" || vehicle.status === "IN_ROUTE") ? (
        <View className="mt-3 pt-3 border-t border-border">
          <Text className="text-center text-primary text-sm font-medium">
            Toque para ver as opções ⚡
          </Text>
        </View>
      ) : null}

      {/* Disabled State - Vehicle Status */}
      {isStatusDisabled ? (
        <View className="mt-3 pt-3 border-t border-border">
          <Text className="text-center text-muted text-sm font-medium">
            {vehicle.status === "BLOCKED"
              ? "🚫 Veículo bloqueado"
              : "⏸️ Veículo inativo"}
          </Text>
        </View>
      ) : null}

      {/* Disabled State - No Permission */}
      {!hasActionPermission && !isStatusDisabled ? (
        <View className="mt-3 pt-3 border-t border-border">
          <Text className="text-center text-muted text-sm font-medium">
            🔒 Permissão de abastecimento ou checklist necessária
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
};
