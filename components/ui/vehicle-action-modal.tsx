import { View, Text, TouchableOpacity, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Vehicle } from "../../types";

interface VehicleActionModalProps {
  visible: boolean;
  vehicle: Vehicle | null;
  canFuel: boolean;
  canChecklist: boolean;
  onClose: () => void;
  onFuelAction: () => void;
  onChecklistAction: () => void;
}

export const VehicleActionModal: React.FC<VehicleActionModalProps> = ({
  visible,
  vehicle,
  canFuel,
  canChecklist,
  onClose,
  onFuelAction,
  onChecklistAction,
}) => {
  if (!vehicle) return null;

  const isInteractable =
    vehicle.status === "ACTIVE" || vehicle.status === "IN_ROUTE";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        className="flex-1 bg-black/50 justify-center px-4"
      >
        <TouchableOpacity
          activeOpacity={1}
          className="bg-white rounded-lg overflow-hidden"
        >
          {/* Header */}
          <View className="px-6 py-4 border-b border-gray-200">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="font-bold text-lg text-gray-900">
                  {vehicle.brand} {vehicle.model}
                </Text>
                <Text className="text-sm text-gray-600">
                  {vehicle.license_plate}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} className="ml-3 p-2">
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Actions */}
          <View className="p-6">
            <Text className="text-base font-medium text-gray-900 mb-4">
              Selecione uma ação:
            </Text>

            <View className="gap-3">
              {/* Fuel Action */}
              {canFuel && (
                <TouchableOpacity
                  onPress={() => {
                    onClose();
                    onFuelAction();
                  }}
                  disabled={!isInteractable}
                  className={`flex-row items-center p-4 rounded-lg border ${
                    isInteractable
                      ? "border-gray-200 bg-white"
                      : "border-gray-100 bg-gray-50"
                  }`}
                >
                  <View
                    className={`w-12 h-12 rounded-full items-center justify-center mr-4 ${
                      isInteractable ? "bg-blue-100" : "bg-gray-100"
                    }`}
                  >
                    <Ionicons
                      name="car"
                      size={24}
                      color={isInteractable ? "#3b82f6" : "#9ca3af"}
                    />
                  </View>
                  <View className="flex-1">
                    <Text
                      className={`font-medium ${
                        isInteractable ? "text-gray-900" : "text-gray-400"
                      }`}
                    >
                      Abastecer Veículo
                    </Text>
                    <Text
                      className={`text-sm ${
                        isInteractable ? "text-gray-600" : "text-gray-400"
                      }`}
                    >
                      Registrar abastecimento do veículo
                    </Text>
                  </View>
                  {isInteractable && (
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color="#9ca3af"
                    />
                  )}
                </TouchableOpacity>
              )}

              {/* Checklist Action */}
              {canChecklist && (
                <TouchableOpacity
                  onPress={() => {
                    onClose();
                    onChecklistAction();
                  }}
                  disabled={!isInteractable}
                  className={`flex-row items-center p-4 rounded-lg border ${
                    isInteractable
                      ? "border-gray-200 bg-white"
                      : "border-gray-100 bg-gray-50"
                  }`}
                >
                  <View
                    className={`w-12 h-12 rounded-full items-center justify-center mr-4 ${
                      isInteractable ? "bg-green-100" : "bg-gray-100"
                    }`}
                  >
                    <Ionicons
                      name="checkmark-done"
                      size={24}
                      color={isInteractable ? "#10b981" : "#9ca3af"}
                    />
                  </View>
                  <View className="flex-1">
                    <Text
                      className={`font-medium ${
                        isInteractable ? "text-gray-900" : "text-gray-400"
                      }`}
                    >
                      Checklist Veicular
                    </Text>
                    <Text
                      className={`text-sm ${
                        isInteractable ? "text-gray-600" : "text-gray-400"
                      }`}
                    >
                      Realizar inspeção do veículo
                    </Text>
                  </View>
                  {isInteractable && (
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color="#9ca3af"
                    />
                  )}
                </TouchableOpacity>
              )}
            </View>

            {!isInteractable && (
              <View
                className="mt-4 p-3 bg-yellow-50 
                rounded-lg border border-yellow-200"
              >
                <Text className="text-sm text-yellow-800 text-center">
                  {vehicle.status === "BLOCKED"
                    ? "🚫 Veículo bloqueado - ações não disponíveis"
                    : "⏸️ Veículo inativo - ações não disponíveis"}
                </Text>
              </View>
            )}
          </View>

          {/* Cancel Button */}
          <TouchableOpacity
            onPress={onClose}
            className="px-6 py-4 border-t 
            border-gray-200 bg-gray-50"
          >
            <Text
              className="text-center 
              text-gray-600 font-medium"
            >
              Cancelar
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};
