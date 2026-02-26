import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  InteractionManager,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { Controller } from "react-hook-form";

import * as ImagePicker from "expo-image-picker";
import {
  Input,
  DatePicker,
  TotalAmountDisplay,
  Button,
  LocationPicker,
} from "../../ui";

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
  // 📍 GEOLOCATION
  onLocationChange: (
    location: {
      latitude: number;
      longitude: number;
      wasManuallyAdjusted: boolean;
      originalLatitude?: number;
      originalLongitude?: number;
    } | null,
  ) => void;
  onLocationLoadingChange?: (isLoading: boolean) => void; // 🔄 Loading state callback
  locationError?: string;
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
  onLocationChange,
  onLocationLoadingChange,
  locationError,
}) => {
  const [isFormReady, setIsFormReady] = useState<boolean>(false);

  const litersInputRef = useRef<TextInput>(null);
  const priceInputRef = useRef<TextInput>(null);

  // Defer heavy form rendering until after step transition completes
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setIsFormReady(true);
    });

    return () => task.cancel();
  }, []);

  // States for formatting fields - initialized from form values for back-navigation persistence
  const [formattedMileage, setFormattedMileage] = useState<string>(() => {
    const mileage = control._formValues?.current_mileage;

    if (mileage && mileage > 0) {
      return mileage.toLocaleString("pt-BR");
    }

    return "";
  });

  const [formattedLiters, setFormattedLiters] = useState<string>(() => {
    const liters = control._formValues?.liters_amount;

    if (liters && liters > 0) {
      return liters.toString().replace(".", ",");
    }

    return "";
  });

  const [formattedPrice, setFormattedPrice] = useState<string>(() => {
    const price = control._formValues?.price_per_liter;

    if (price && price > 0) {
      return `R$ ${price.toString().replace(".", ",")}`;
    }

    return "";
  });

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
    [onTotalChange],
  );

  if (!isFormReady) {
    return (
      <View className="flex-1 justify-center items-center py-20">
        <Text className="text-gray-500 text-base">
          Carregando formulário...
        </Text>
      </View>
    );
  }

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
                className="text-sm text-gray-900 flex-1 font-medium"
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {" "}
                {stepData.branchName || "N/A"}
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-sm text-gray-600">Motorista:</Text>
              <Text
                className="text-sm text-gray-900 flex-1 font-medium"
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {" "}
                {stepData.driverName || "N/A"}
                {stepData.driverCnh && ` (CNH: ${stepData.driverCnh})`}
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-sm text-gray-600">Combustível:</Text>
              <Text
                className="text-sm text-gray-900 flex-1 font-medium"
                numberOfLines={1}
                ellipsizeMode="tail"
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
              required
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
              required
              placeholder="Ex: 50.000"
              value={formattedMileage}
              onChangeText={(text) => {
                const formatted = formatMileage(text);
                setFormattedMileage(formatted);

                const numValue = parseFormattedValue(formatted);
                onChange(numValue || undefined);
              }}
              onBlur={() => {
                onBlur();
                trigger("current_mileage");
              }}
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
              inputRef={litersInputRef}
              label="Quantidade de Litros"
              required
              placeholder="Ex: 45,500"
              value={formattedLiters}
              onChangeText={(text) => {
                // Block input if decimal part already has 3 digits
                const separatorIdx = Math.max(
                  text.lastIndexOf(","),
                  text.lastIndexOf("."),
                );
                if (separatorIdx !== -1) {
                  const decimalDigits = text
                    .substring(separatorIdx + 1)
                    .replace(/\D/g, "");
                  if (decimalDigits.length > 3) {
                    litersInputRef.current?.setNativeProps({
                      text: formattedLiters,
                    });
                    return;
                  }
                }

                const formatted = formatLiters(text);
                setFormattedLiters(formatted);

                const numValue = parseFormattedValue(formatted);
                onChange(numValue || undefined);

                updateTotal(formatted, formattedPrice);
              }}
              onBlur={() => {
                onBlur();
                trigger("liters_amount");
              }}
              error={errors.liters_amount?.message}
              keyboardType="numeric"
            />
          )}
        />

        {/* Price per Liter */}
        <Controller
          control={control}
          name="price_per_liter"
          render={({ field: { onChange, onBlur } }) => (
            <Input
              inputRef={priceInputRef}
              label="Preço por Litro"
              required
              placeholder="Ex: R$ 5,999"
              value={formattedPrice}
              onChangeText={(text) => {
                // Block input if decimal part already has 3 digits
                const cleanText = text.replace(/^R\$\s*/, "");
                const separatorIdx = Math.max(
                  cleanText.lastIndexOf(","),
                  cleanText.lastIndexOf("."),
                );

                if (separatorIdx !== -1) {
                  const decimalDigits = cleanText
                    .substring(separatorIdx + 1)
                    .replace(/\D/g, "");

                  if (decimalDigits.length > 3) {
                    priceInputRef.current?.setNativeProps({
                      text: formattedPrice,
                    });
                    return;
                  }
                }

                const formatted = formatCurrency(text);
                setFormattedPrice(formatted);

                const numValue = parseFormattedValue(formatted);

                onChange(numValue || undefined);
                updateTotal(formattedLiters, formatted);
              }}
              onBlur={() => {
                if (formattedPrice && formattedPrice !== "R$ ") {
                  const numValue = parseFormattedValue(formattedPrice);
                  if (numValue > 0) {
                    // Auto-format with decimals: "23" → "R$ 23,00", "5,9" → "R$ 5,90"
                    const commaIdx = formattedPrice.indexOf(",");
                    const existingDecimals =
                      commaIdx !== -1
                        ? formattedPrice.substring(commaIdx + 1).length
                        : 0;

                    const decimals = existingDecimals >= 3 ? 3 : 2;
                    const formatted = `R$ ${numValue.toFixed(decimals).replace(".", ",")}`;

                    setFormattedPrice(formatted);
                  }
                }
                onBlur();
                trigger("price_per_liter");
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
              <Text className="mt-3 text-gray-500">(máx. 5MB)</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 📍 GEOLOCATION: Location Picker */}
        <LocationPicker
          onLocationChange={onLocationChange}
          onLoadingChange={onLocationLoadingChange}
          error={locationError}
        />

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
