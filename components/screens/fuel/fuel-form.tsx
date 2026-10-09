import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  InteractionManager,
} from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";
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
  formatKmReading,
  formatMileage,
  formatLiters,
  parseFormattedValue,
} from "@/utils/formatters";
import { nextPricePerLiterText } from "@/features/fuel/fuel-rules";
import type { FieldFocus } from "@/features/forms/use-field-focus";
import { FieldAnchor } from "../../forms/field-anchor";
import { useThemeColors } from "@/hooks/use-theme";

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

  /** Where a failed submit scrolls to and focuses (decision 16.700). */
  fieldFocus?: FieldFocus;

  /** The missing-photo message, once it should show. */
  odometerPhotoError?: string;
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

  /** The phone's pre-check warning about the photo (decision 14.2), if any. */
  precheckNotice?: React.ReactNode;
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
  fieldFocus,
  odometerPhotoError,
  isDriver = false,
  onLocationChange,
  precheckNotice,
  onLocationLoadingChange,
  locationError,
}) => {
  const [isFormReady, setIsFormReady] = useState<boolean>(false);
  const colors = useThemeColors();

  const ownLitersInputRef = useRef<TextInput>(null);
  const ownPriceInputRef = useRef<TextInput>(null);

  // The same refs the submit focuses, when the screen passes them.
  const litersInputRef = fieldFocus?.inputRef("liters_amount") ?? ownLitersInputRef;
  const priceInputRef = fieldFocus?.inputRef("price_per_liter") ?? ownPriceInputRef;

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
        <Text className="text-muted text-base">
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
          className="bg-card rounded-lg
          p-4 mb-6 border border-border"
        >
          <Text className="font-bold text-ink mb-3">
            📋 Resumo da Seleção
          </Text>

          <View className="space-y-3">
            <View className="flex-row">
              <Text className="text-sm text-muted">Filial:</Text>
              <Text
                className="text-sm text-ink flex-1 font-medium"
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {" "}
                {stepData.branchName || "N/A"}
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-sm text-muted">Motorista:</Text>
              <Text
                className="text-sm text-ink flex-1 font-medium"
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {" "}
                {stepData.driverName || "N/A"}
                {stepData.driverCnh && ` (CNH: ${stepData.driverCnh})`}
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-sm text-muted">Combustível:</Text>
              <Text
                className="text-sm text-ink flex-1 font-medium"
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
        className="bg-primary-soft rounded-lg 
        p-4 mb-6 border border-primary/40"
      >
        <Text
          className="font-bold 
          text-primary mb-3"
        >
          ℹ️ Informações importantes:
        </Text>
        <View className="space-y-2">
          <Text className="text-sm text-primary">
            • Informe a quilometragem atual do veículo no momento do
            reabastecimento
          </Text>
          <Text className="text-sm text-primary">
            • Não é possível informar uma quilometragem menor que a atual do
            veículo
          </Text>
          <Text className="text-sm text-primary">
            • O valor total será calculado automaticamente (litros × preço por
            litro)
          </Text>
        </View>
      </View>

      {/* Vehicle Data */}
      {vehicleData && !isLoadingVehicle && (
        <View
          className="bg-success-soft rounded-lg 
          p-4 mb-6 border border-success/40"
        >
          <Text className="font-bold text-success mb-3">
            🚗 Dados do Veículo Selecionado:
          </Text>
          <View className="space-y-1">
            <Text className="text-sm text-success">
              Quilometragem atual:{" "}
              {formatKmReading(vehicleData.current_mileage) ?? "N/A"} km
            </Text>
            <Text className="text-sm text-success">
              Intervalo de manutenção:{" "}
              {formatKmReading(vehicleData.maintenance_interval_km) ?? "N/A"}{" "}
              km
            </Text>
            {vehicleData.last_maintenance_mileage && (
              <Text className="text-sm text-success">
                Última manutenção:{" "}
                {formatKmReading(vehicleData.last_maintenance_mileage)} km
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Loading Vehicle Data */}
      {isLoadingVehicle && (
        <View
          className="bg-subtle rounded-lg 
          p-4 mb-6 border border-border"
        >
          <Text
            className="text-sm 
            text-muted text-center"
          >
            Carregando dados do veículo...
          </Text>
        </View>
      )}

      {/* Form Fields with improved spacing */}
      <View className="gap-4">
        {/* Date */}
        <FieldAnchor name="refueling_date" focus={fieldFocus}>
        <Controller
          control={control}
          name="refueling_date"
          render={({ field: { onChange, value } }) => (
            <DatePicker
              label="Data do Abastecimento"
              required
              value={value ? new Date(value) : new Date()}
              onDateChange={(date) => {
                onChange(date.toISOString());

                // The km rule depends on the date (decision 16.703): a shown
                // km message is re-checked against the new one.
                if (errors.current_mileage) trigger("current_mileage");
              }}
              error={errors.refueling_date?.message}
              maximumDate={new Date()}
            />
          )}
        />
        </FieldAnchor>

        {/* Current Mileage */}
        <FieldAnchor name="current_mileage" focus={fieldFocus}>
        <Controller
          control={control}
          name="current_mileage"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Quilometragem Atual (km)"
              testID="fuel-mileage"
              inputRef={fieldFocus?.inputRef("current_mileage")}
              required
              placeholder="Ex: 50.000"
              value={formattedMileage}
              onChangeText={(text) => {
                const formatted = formatMileage(text);
                setFormattedMileage(formatted);

                const numValue = parseFormattedValue(formatted);
                onChange(numValue || undefined);
              }}
              onBlur={onBlur}
              error={errors.current_mileage?.message}
              keyboardType="numeric"
            />
          )}
        />
        </FieldAnchor>

        {/* Liters */}
        <FieldAnchor name="liters_amount" focus={fieldFocus}>
        <Controller
          control={control}
          name="liters_amount"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              inputRef={litersInputRef}
              label="Quantidade de Litros"
              testID="fuel-liters"
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
              onBlur={onBlur}
              error={errors.liters_amount?.message}
              keyboardType="numeric"
            />
          )}
        />
        </FieldAnchor>

        {/* Price per Liter */}
        <FieldAnchor name="price_per_liter" focus={fieldFocus}>
        <Controller
          control={control}
          name="price_per_liter"
          render={({ field: { onChange, onBlur } }) => (
            <Input
              inputRef={priceInputRef}
              label="Preço por Litro"
              testID="fuel-price"
              required
              placeholder="Ex: R$ 5,999"
              value={formattedPrice}
              onChangeText={(text) => {
                // Two integer digits and three decimals at most
                // (nextPricePerLiterText): a refused keystroke keeps the text.
                const formatted = nextPricePerLiterText(text);

                if (formatted === null) {
                  priceInputRef.current?.setNativeProps({
                    text: formattedPrice,
                  });
                  return;
                }

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
              }}
              error={errors.price_per_liter?.message}
              keyboardType="numeric"
            />
          )}
        />
        </FieldAnchor>

        {/* Total Amount Display */}
        <TotalAmountDisplay amount={calculatedTotal} />

        {/* Odometer Photo */}
        <FieldAnchor name="odometer_photo" focus={fieldFocus} className="mb-6">
          <Text className="text-ink-soft font-medium mb-2">
            Foto do Odômetro <Text className="text-destructive">*</Text>
          </Text>

          {odometerImage ? (
            <View
              className="border border-success/40 
              rounded-lg p-3 bg-success-soft"
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
              testID="fuel-odometer-photo"
              accessibilityRole="button"
              accessibilityLabel={
                odometerPhotoError
                  ? `Adicionar foto do odômetro, obrigatório. ${odometerPhotoError}`
                  : "Adicionar foto do odômetro, obrigatório"
              }
              // Neutral until the photo is actually missing (decision 16.700).
              className={`border-2 border-dashed rounded-lg p-6 items-center ${
                odometerPhotoError
                  ? "border-destructive bg-destructive-soft"
                  : "border-input"
              }`}
            >
              <Ionicons
                name="camera"
                size={48}
                color={odometerPhotoError ? colors.destructive : colors.muted}
              />
              <Text className="text-muted mt-2 font-medium">
                Adicionar Foto do Odômetro
              </Text>
              <Text className="text-muted text-sm mt-1">
                Toque para tirar foto ou selecionar da galeria
              </Text>
              <Text className="mt-3 text-muted">(máx. 5MB)</Text>
            </TouchableOpacity>
          )}
          {!odometerImage && odometerPhotoError ? (
            <Text className="text-destructive text-sm mt-1">{odometerPhotoError}</Text>
          ) : null}
        </FieldAnchor>

        {odometerImage ? precheckNotice : null}

        {/* 📍 GEOLOCATION: Location Picker */}
        <FieldAnchor name="latitude" focus={fieldFocus}>
          <LocationPicker
            onLocationChange={onLocationChange}
            onLoadingChange={onLocationLoadingChange}
            error={locationError}
          />
        </FieldAnchor>

        {/* Notes - Smaller field */}
        <FieldAnchor name="notes" focus={fieldFocus}>
        <Controller
          control={control}
          name="notes"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Observações (Opcional)"
              inputRef={fieldFocus?.inputRef("notes")}
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
        </FieldAnchor>
      </View>

      {/* Bottom Spacing */}
      <View className="h-20" />
    </View>
  );
};
