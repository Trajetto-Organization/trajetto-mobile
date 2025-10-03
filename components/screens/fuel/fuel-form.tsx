import { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, Image } from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { Controller } from "react-hook-form";

import * as ImagePicker from "expo-image-picker";
import { Input, DatePicker, TotalAmountDisplay, Button } from "../../ui";

import {
  formatMileage,
  formatLiters,
  formatCurrency,
  parseFormattedValue,
} from "../../../utils/formatters";

interface StepData {
  branchId?: string;
  branchName?: string;
  driverId?: string;
  driverName?: string;
  driverCnh?: string;
  fuelTypeId?: string;
  fuelTypeName?: string;
}

interface FuelFormProps {
  control: any;
  errors: any;
  odometerImage: ImagePicker.ImagePickerAsset | null;
  onImagePicker: () => void;
  onRemoveImage: () => void;
  stepData: Partial<StepData>;
  calculatedTotal: number;
  onTotalChange: (total: number) => void;
  vehicleData: any;
  isLoadingVehicle: boolean;
  trigger: any;
  isDriver?: boolean; // Flag to hide summary for drivers
}

export const FuelForm: React.FC<FuelFormProps> = ({
  control,
  errors,
  odometerImage,
  onImagePicker,
  onRemoveImage,
  stepData,
  calculatedTotal,
  onTotalChange,
  vehicleData,
  isLoadingVehicle,
  trigger,
  isDriver = false,
}) => {
  // States for formatting fields
  const [formattedMileage, setFormattedMileage] = useState<string>("");
  const [formattedLiters, setFormattedLiters] = useState<string>("");

  const [formattedPrice, setFormattedPrice] = useState<string>("");

  // Function to update the calculated total value
  const updateTotal = useCallback(
    (liters: string, price: string) => {
      const litersValue = parseFormattedValue(liters);
      const priceValue = parseFormattedValue(price);

      if (litersValue > 0 && priceValue > 0) {
        const total = litersValue * priceValue;
        onTotalChange(total);
      } else {
        onTotalChange(0);
      }
    },
    [onTotalChange]
  );

  return (
    <View className="flex-1 px-6 pt-6">
      {/* Selected Items Summary - Hidden for drivers */}
      {!isDriver && (
        <View
          className="bg-white rounded-lg
          p-4 mb-6 border border-gray-200"
        >
          <Text className="font-bold text-gray-900 mb-3">
            📋 Resumo da Seleção
          </Text>

          <View className="space-y-3">
            <View className="flex-row">
              <Text className="text-sm text-gray-600">Filial:</Text>
              <Text
                className="text-sm text-gray-900
                flex-1 font-medium"
              >
                {" "}
                {stepData.branchName || "N/A"}
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-sm text-gray-600">Motorista:</Text>
              <Text
                className="text-sm text-gray-900
                flex-1 font-medium"
              >
                {" "}
                {stepData.driverName || "N/A"}
                {stepData.driverCnh && (
                  <Text className="text-xs text-gray-500">
                    {" "}
                    (CNH: {stepData.driverCnh})
                  </Text>
                )}
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-sm text-gray-600">Combustível:</Text>
              <Text
                className="text-sm text-gray-900
                flex-1 font-medium"
              >
                {" "}
                {stepData.fuelTypeName || "N/A"}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Important Information */}
      <View
        className="bg-blue-50 rounded-lg 
        p-4 mb-6 border border-blue-200"
      >
        <Text
          className="font-bold 
          text-blue-900 mb-3"
        >
          ℹ️ Informações importantes:
        </Text>
        <View className="space-y-2">
          <Text className="text-sm text-blue-800">
            • Informe a quilometragem atual do veículo no momento do
            reabastecimento
          </Text>
          <Text className="text-sm text-blue-800">
            • Não é possível informar uma quilometragem menor que a atual do
            veículo
          </Text>
          <Text className="text-sm text-blue-800">
            • O valor total será calculado automaticamente (litros × preço por
            litro)
          </Text>
        </View>
      </View>

      {/* Vehicle Data */}
      {vehicleData && !isLoadingVehicle && (
        <View
          className="bg-green-50 rounded-lg 
          p-4 mb-6 border border-green-200"
        >
          <Text className="font-bold text-green-900 mb-3">
            🚗 Dados do Veículo Selecionado:
          </Text>
          <View className="space-y-1">
            <Text className="text-sm text-green-800">
              Quilometragem atual:{" "}
              {vehicleData.current_mileage?.toLocaleString() || "N/A"} km
            </Text>
            <Text className="text-sm text-green-800">
              Intervalo de manutenção:{" "}
              {vehicleData.maintenance_interval_km?.toLocaleString() || "N/A"}{" "}
              km
            </Text>
            {vehicleData.last_maintenance_mileage && (
              <Text className="text-sm text-green-800">
                Última manutenção:{" "}
                {vehicleData.last_maintenance_mileage.toLocaleString()} km
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Loading Vehicle Data */}
      {isLoadingVehicle && (
        <View
          className="bg-gray-50 rounded-lg 
          p-4 mb-6 border border-gray-200"
        >
          <Text
            className="text-sm 
            text-gray-600 text-center"
          >
            Carregando dados do veículo...
          </Text>
        </View>
      )}

      {/* Form Fields with improved spacing */}
      <View className="gap-4">
        {/* Date */}
        <Controller
          control={control}
          name="refueling_date"
          render={({ field: { onChange, value } }) => (
            <DatePicker
              label="Data do Abastecimento"
              value={value ? new Date(value) : new Date()}
              onDateChange={(date) => onChange(date.toISOString())}
              error={errors.refueling_date?.message}
              maximumDate={new Date()}
            />
          )}
        />

        {/* Current Mileage */}
        <Controller
          control={control}
          name="current_mileage"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Quilometragem Atual (km)"
              placeholder="Ex: 50.000"
              value={formattedMileage}
              onChangeText={(text) => {
                const formatted = formatMileage(text);
                setFormattedMileage(formatted);

                // Converts to number and sends to control
                const numValue = parseFormattedValue(formatted);
                onChange(numValue || undefined);

                // Trigger validation
                trigger("current_mileage");
              }}
              onBlur={onBlur}
              error={errors.current_mileage?.message}
              keyboardType="numeric"
            />
          )}
        />

        {/* Liters */}
        <Controller
          control={control}
          name="liters_amount"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Quantidade de Litros"
              placeholder="Ex: 45,500"
              value={formattedLiters}
              onChangeText={(text) => {
                const formatted = formatLiters(text);
                setFormattedLiters(formatted);

                // Converts to number and sends to control
                const numValue = parseFormattedValue(formatted);
                onChange(numValue || undefined);

                // Calculate total immediately
                updateTotal(formatted, formattedPrice);

                // Trigger validation
                trigger("liters_amount");
              }}
              onBlur={onBlur}
              error={errors.liters_amount?.message}
              keyboardType="numeric"
            />
          )}
        />

        {/* Price per Liter */}
        <Controller
          control={control}
          name="price_per_liter"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Preço por Litro"
              placeholder="Ex: R$ 5,999"
              value={formattedPrice}
              onChangeText={(text) => {
                const formatted = formatCurrency(text);
                setFormattedPrice(formatted);

                // Converts to number and sends to control
                const numValue = parseFormattedValue(formatted);
                onChange(numValue || undefined);

                // Calculate total immediately
                updateTotal(formattedLiters, formatted);

                // Trigger validation
                trigger("price_per_liter");
              }}
              onBlur={() => {
                // Format better when leaving the field
                if (formattedPrice && formattedPrice !== "R$ ") {
                  const numValue = parseFormattedValue(formattedPrice);
                  if (numValue > 0) {
                    const betterFormatted = formatCurrency(numValue.toString());
                    setFormattedPrice(betterFormatted);
                  }
                }
                onBlur();
              }}
              error={errors.price_per_liter?.message}
              keyboardType="numeric"
            />
          )}
        />

        {/* Total Amount Display */}
        <TotalAmountDisplay amount={calculatedTotal} />

        {/* Odometer Photo */}
        <View className="mb-6">
          <Text className="text-gray-700 font-medium mb-2">
            Foto do Odômetro <Text className="text-red-500">*</Text>
          </Text>

          {odometerImage ? (
            <View
              className="border border-green-300 
              rounded-lg p-3 bg-green-50"
            >
              <Image
                source={{ uri: odometerImage.uri }}
                className="w-full h-48 rounded-lg mb-3"
                resizeMode="cover"
              />
              <View className="flex-row gap-2">
                <Button
                  onPress={onImagePicker}
                  variant="outline"
                  className="flex-1"
                  size="sm"
                >
                  Trocar Foto
                </Button>
                <Button
                  onPress={onRemoveImage}
                  variant="danger"
                  className="flex-1"
                  size="sm"
                >
                  Remover
                </Button>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={onImagePicker}
              className="border-2 border-dashed 
              border-gray-300 rounded-lg p-6 items-center"
            >
              <Ionicons name="camera" size={48} color="#9ca3af" />
              <Text className="text-gray-600 mt-2 font-medium">
                Adicionar Foto do Odômetro
              </Text>
              <Text className="text-gray-500 text-sm mt-1">
                Toque para tirar foto ou selecionar da galeria
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Notes - Smaller field */}
        <Controller
          control={control}
          name="notes"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Observações (Opcional)"
              placeholder="Digite observações sobre o abastecimento..."
              value={value || ""}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.notes?.message}
              multiline
              numberOfLines={2}
              className="mb-6"
            />
          )}
        />
      </View>

      {/* Bottom Spacing */}
      <View className="h-20" />
    </View>
  );
};
