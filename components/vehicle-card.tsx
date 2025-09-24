import { View, Text, TouchableOpacity } from "react-native";

import { canRefuelVehicles } from "../utils/permissions";
import { useAuthStore } from "../store";

import { Vehicle } from "../types";

interface VehicleCardProps {
  vehicle: Vehicle;
  onPress?: () => void;
  onRefuel?: () => void;
}

const getStatusColor = (status: Vehicle["status"]) => {
  switch (status) {
    case "ACTIVE":
      return "bg-success-100 text-success-800";
    case "IN_ROUTE":
      return "bg-blue-100 text-blue-800";
    case "INACTIVE":
      return "bg-gray-100 text-gray-800";
    case "BLOCKED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
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
  onPress,
  onRefuel,
}) => {
  const { user } = useAuthStore();
  const canRefuel = canRefuelVehicles(user);

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
    // Only allow interaction for ACTIVE and IN_ROUTE vehicles
    const isInteractable =
      vehicle.status === "ACTIVE" || vehicle.status === "IN_ROUTE";

    if (onPress && isInteractable) {
      onPress();
    } else if (canRefuel && onRefuel && isInteractable) {
      onRefuel();
    }
  };

  // Helper function to extract year from date string
  const getYearFromDate = (dateString: string) => {
    if (!dateString || dateString === "N/A") return "N/A";

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
  const isDisabled =
    vehicle.status === "INACTIVE" || vehicle.status === "BLOCKED";

  return (
    <TouchableOpacity
      onPress={handleCardPress}
      activeOpacity={isDisabled ? 1 : 0.7}
      disabled={isDisabled}
      className={`bg-white rounded-lg 
      shadow-sm border p-4 mb-3 mx-4 ${
        isDisabled ? "border-gray-300 opacity-60" : "border-gray-200"
      }`}
    >
      {/* Header: Brand/Model and Status */}
      <View className="flex-row justify-between items-start mb-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-gray-900">
            {safeString(vehicle.brand)} {safeString(vehicle.model)}
          </Text>
          <Text className="text-sm text-gray-600">
            {getYearFromDate(vehicle.model_year)} •{" "}
            {safeString(vehicle.description)}
          </Text>
        </View>
        <View
          className={`px-3 py-1 rounded-full ${getStatusColor(
            vehicle.status || "INACTIVE"
          )}`}
        >
          <Text className="text-xs font-medium">
            {getStatusText(vehicle.status || "INACTIVE")}
          </Text>
        </View>
      </View>

      {/* License Plate */}
      <View className="mb-3">
        <Text
          className="text-xs text-gray-500 
          uppercase tracking-wide mb-1"
        >
          Placa
        </Text>
        <Text
          className="text-base 
          font-semibold text-gray-900"
        >
          {safeString(vehicle.license_plate)}
        </Text>
      </View>

      {/* Mileage Information */}
      <View className="flex-row justify-between items-end">
        <View>
          <Text
            className="text-xs text-gray-500 
            uppercase tracking-wide mb-1"
          >
            Quilometragem Atual
          </Text>
          <Text
            className="text-base 
            font-semibold text-gray-900"
          >
            {formatMileage(vehicle.current_mileage)}
          </Text>
        </View>

        <View className="items-end">
          <Text
            className="text-xs text-gray-500 
            uppercase tracking-wide mb-1"
          >
            Combustível
          </Text>
          <Text className="text-sm font-medium text-gray-700">
            {safeString(vehicle.fuelTypeDescription)}
          </Text>
        </View>
      </View>

      {/* Maintenance Info (if available) */}
      {vehicle.last_maintenance_mileage &&
      Number(vehicle.last_maintenance_mileage) > 0 ? (
        <View className="mt-3 pt-3 border-t border-gray-100">
          <View className="flex-row justify-between">
            <View>
              <Text
                className="text-xs text-gray-500 
                uppercase tracking-wide mb-1"
              >
                Última Manutenção
              </Text>
              <Text className="text-sm text-gray-700">
                {formatMileage(vehicle.last_maintenance_mileage)}
              </Text>
            </View>
            <View className="items-end">
              <Text
                className="text-xs text-gray-500 
                uppercase tracking-wide mb-1"
              >
                Intervalo
              </Text>
              <Text className="text-sm text-gray-700">
                {formatMileage(vehicle.maintenance_interval_km)}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* Action Hint */}
      {canRefuel === true &&
      (vehicle.status === "ACTIVE" || vehicle.status === "IN_ROUTE") ? (
        <View className="mt-3 pt-3 border-t border-gray-100">
          <Text className="text-center text-primary-600 text-sm font-medium">
            Toque para ver as opções ⚡
          </Text>
        </View>
      ) : null}

      {/* Disabled State Message */}
      {isDisabled === true ? (
        <View
          className="mt-3 pt-3 
          border-t border-gray-100"
        >
          <Text
            className="text-center 
            text-gray-400 text-sm font-medium"
          >
            {vehicle.status === "BLOCKED"
              ? "🚫 Veículo bloqueado"
              : "⏸️ Veículo inativo"}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
};
