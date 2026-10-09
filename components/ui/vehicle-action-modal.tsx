import { View, Text, TouchableOpacity, Modal } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Vehicle } from "../../types";
import { useThemeColors } from "../../hooks/use-theme";

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
  const colors = useThemeColors();

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
          className="bg-card rounded-lg overflow-hidden"
        >
          {/* Header */}
          <View className="px-6 py-4 border-b border-border">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="font-bold text-lg text-ink">
                  {vehicle.brand} {vehicle.model}
                </Text>
                <Text className="text-sm text-muted">
                  {vehicle.license_plate}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} className="ml-3 p-2">
                <Ionicons name="close" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Actions */}
          <View className="p-6">
            <Text className="text-base font-medium text-ink mb-4">
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
                  testID="vehicle-action-fuel"
                  accessibilityRole="button"
                  className={`flex-row items-center p-4 rounded-lg border ${
                    isInteractable
                      ? "border-border bg-card"
                      : "border-border bg-subtle"
                  }`}
                >
                  <View
                    className={`w-12 h-12 rounded-full items-center justify-center mr-4 ${
                      isInteractable ? "bg-primary-soft" : "bg-subtle"
                    }`}
                  >
                    <Ionicons
                      name="car"
                      size={24}
                      color={isInteractable ? colors.primary : colors.muted}
                    />
                  </View>
                  <View className="flex-1">
                    <Text
                      className={`font-medium ${
                        isInteractable ? "text-ink" : "text-muted"
                      }`}
                    >
                      Abastecer Veículo
                    </Text>
                    <Text className="text-sm text-muted">
                      Registrar abastecimento do veículo
                    </Text>
                  </View>
                  {isInteractable && (
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={colors.muted}
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
                  testID="vehicle-action-checklist"
                  accessibilityRole="button"
                  className={`flex-row items-center p-4 rounded-lg border ${
                    isInteractable
                      ? "border-border bg-card"
                      : "border-border bg-subtle"
                  }`}
                >
                  <View
                    className={`w-12 h-12 rounded-full items-center justify-center mr-4 ${
                      isInteractable ? "bg-success-soft" : "bg-subtle"
                    }`}
                  >
                    <Ionicons
                      name="checkmark-done"
                      size={24}
                      color={isInteractable ? colors.success : colors.muted}
                    />
                  </View>
                  <View className="flex-1">
                    <Text
                      className={`font-medium ${
                        isInteractable ? "text-ink" : "text-muted"
                      }`}
                    >
                      Checklist Veicular
                    </Text>
                    <Text className="text-sm text-muted">
                      Realizar inspeção do veículo
                    </Text>
                  </View>
                  {isInteractable && (
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={colors.muted}
                    />
                  )}
                </TouchableOpacity>
              )}
            </View>

            {!isInteractable && (
              <View
                className="mt-4 p-3 bg-warning-soft 
                rounded-lg border border-warning/40"
              >
                <Text className="text-sm text-warning text-center">
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
            border-border bg-subtle"
          >
            <Text className="text-center text-ink-soft font-medium">
              Cancelar
            </Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};
