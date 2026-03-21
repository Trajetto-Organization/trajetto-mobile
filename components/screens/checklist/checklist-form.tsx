import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  InteractionManager,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { Controller, useWatch } from "react-hook-form";

import * as ImagePicker from "expo-image-picker";
import { Input, DatePicker, Select } from "../../ui";

import { formatMileage, parseFormattedValue } from "@/utils/formatters";

interface StepData {
  branchId?: string;
  branchName?: string;
  driverId?: string;
  driverName?: string;
  driverCnh?: string;
}

interface ChecklistImages {
  [fieldName: string]: ImagePicker.ImagePickerAsset[];
}

interface ChecklistFormProps {
  control: any;
  errors: any;
  checklistImages: ChecklistImages;
  onImagePicker: (fieldName: string) => void;
  onRemoveImage: (fieldName: string, imageIndex: number) => void;
  stepData: Partial<StepData>;
  vehicleData: any;
  isLoadingVehicle: boolean;
  trigger: any;
  isDriver?: boolean; // Flag to hide summary for drivers
}

// Smart photo requirements based on backend logic
const getPhotoRequirements = (formData: any) => {
  const requirements = {
    // Always required
    current_mileage: { required: true, reason: "Proteção legal - obrigatório" },
    fuel_level_adequate: {
      required: true,
      reason: "Proteção legal - obrigatório",
    },
    tires_condition: { required: true, reason: "Proteção legal - obrigatório" },

    // Required if not OK
    brakes_working: {
      required: !formData.brakes_working,
      reason: "Segurança crítica - obrigatório se não OK",
    },
    headlights_working: {
      required: !formData.headlights_working,
      reason: "Segurança crítica - obrigatório se não OK",
    },
    taillights_working: {
      required: !formData.taillights_working,
      reason: "Segurança crítica - obrigatório se não OK",
    },
    turn_signals_working: {
      required: !formData.turn_signals_working,
      reason: "Segurança crítica - obrigatório se não OK",
    },
    steering_wheel_condition: {
      required: formData.steering_wheel_condition !== "good",
      reason: "Segurança crítica - obrigatório se não OK",
    },
    battery_condition: {
      required: formData.battery_condition !== "good",
      reason: "Segurança crítica - obrigatório se não OK",
    },
    bumpers_condition: {
      required: formData.bumpers_condition !== "good",
      reason: "Segurança crítica - obrigatório se não OK",
    },
    windshield_condition: {
      required: formData.windshield_condition !== "good",
      reason: "Segurança crítica - obrigatório se não OK",
    },
    mirrors_condition: {
      required: formData.mirrors_condition !== "good",
      reason: "Segurança crítica - obrigatório se não OK",
    },
    spare_tire_condition: {
      required: formData.spare_tire_condition !== "good",
      reason: "Segurança crítica - obrigatório se não OK",
    },

    // Technical checks - required if not OK
    oil_level_adequate: {
      required: !formData.oil_level_adequate,
      reason: "Verificação técnica - obrigatório se não OK",
    },
    radiator_water_adequate: {
      required: !formData.radiator_water_adequate,
      reason: "Verificação técnica - obrigatório se não OK",
    },
    brake_fluid_adequate: {
      required: !formData.brake_fluid_adequate,
      reason: "Verificação técnica - obrigatório se não OK",
    },

    // Internal items - required if not OK
    seatbelts_working: {
      required: !formData.seatbelts_working,
      reason: "Itens internos - obrigatório se não OK",
    },
    dashboard_working: {
      required: !formData.dashboard_working,
      reason: "Itens internos - obrigatório se não OK",
    },
    clutch_working: {
      required: !formData.clutch_working,
      reason: "Itens internos - obrigatório se não OK",
    },
  };

  return requirements;
};

const conditionOptions = [
  { label: "Bom", value: "good" },
  { label: "Ruim", value: "bad" },
  { label: "Precisa de atenção", value: "needs_attention" },
];

const booleanOptions = [
  { label: "Sim", value: "true" },
  { label: "Não", value: "false" },
];

const overallConditionOptions = [
  { label: "Aprovado", value: "approved" },
  { label: "Aprovado com restrições", value: "approved_with_restrictions" },
  { label: "Reprovado", value: "rejected" },
];

export const ChecklistForm: React.FC<ChecklistFormProps> = ({
  control,
  errors,
  checklistImages,
  onImagePicker,
  onRemoveImage,
  stepData,
  vehicleData,
  isLoadingVehicle,
  trigger,
  isDriver = false,
}) => {
  const [isFormReady, setIsFormReady] = useState<boolean>(false);

  // Defer heavy form rendering until after step transition completes
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setIsFormReady(true);
    });
    return () => task.cancel();
  }, []);

  // Initialize formatted mileage from form values (for back-navigation persistence)
  const [formattedMileage, setFormattedMileage] = useState<string>(() => {
    const mileage = control._formValues?.current_mileage;

    if (mileage && mileage > 0) {
      return mileage.toLocaleString("pt-BR");
    }

    return "";
  });

  // Watch all form values to determine photo requirements
  const formData = useWatch({ control });
  const photoRequirements = getPhotoRequirements(formData);

  const renderPhotoSection = (fieldName: string, label: string) => {
    const requirement =
      photoRequirements[fieldName as keyof typeof photoRequirements];

    const images = checklistImages[fieldName] || [];
    const isRequired = requirement?.required;

    return (
      <View className="mb-4">
        <View className="mb-2">
          <View className="flex-row items-center flex-wrap">
            <Text className="text-sm font-medium text-gray-700">
              📷 {label}
              {isRequired && <Text className="text-red-500"> *</Text>}
            </Text>
          </View>
          {requirement?.reason && (
            <Text className="text-xs text-gray-500 mt-1 flex-wrap">
              {requirement.reason}
            </Text>
          )}
        </View>

        {images.length > 0 ? (
          <View className="flex-row flex-wrap gap-2 mb-2">
            {images.map((image, index) => (
              <View key={index} className="relative">
                <Image
                  source={{ uri: image.uri }}
                  className="w-20 h-20 rounded-lg"
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={() => onRemoveImage(fieldName, index)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500
                  rounded-full items-center justify-center"
                >
                  <Ionicons name="close" size={12} color="white" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        <TouchableOpacity
          onPress={() => onImagePicker(fieldName)}
          className={`border-2 border-dashed rounded-lg p-3 items-center ${
            isRequired ? "border-red-300 bg-red-50" : "border-gray-300"
          }`}
        >
          <Ionicons
            name="camera"
            size={24}
            color={isRequired ? "#ef4444" : "#9ca3af"}
          />
          <Text
            className={`text-sm mt-1 ${
              isRequired ? "text-red-600" : "text-gray-600"
            }`}
          >
            {images.length > 0 ? "Adicionar mais fotos" : "Adicionar foto"}
          </Text>
          {isRequired && (
            <Text className="text-xs text-red-500 mt-1">Obrigatório</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

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
        <View className="bg-white rounded-lg p-4 mb-6 border border-gray-200">
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
                {stepData.driverCnh && (
                  <Text className="text-xs text-gray-500">
                    {" "}
                    (CNH: {stepData.driverCnh})
                  </Text>
                )}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Important Information */}
      <View className="bg-blue-50 rounded-lg p-4 mb-6 border border-blue-200">
        <Text className="font-bold text-blue-900 mb-3">
          ℹ️ Informações importantes:
        </Text>
        <View className="space-y-2">
          <Text className="text-sm text-blue-800">
            • Informe a quilometragem atual do veículo no momento da inspeção
          </Text>
          <Text className="text-sm text-blue-800">
            • Fotos são obrigatórias para itens com problemas ou condições
            críticas
          </Text>
          <Text className="text-sm text-blue-800">
            • Algumas fotos são sempre obrigatórias por questões legais
          </Text>
        </View>
      </View>

      {/* Vehicle Data */}
      {vehicleData && !isLoadingVehicle && (
        <View className="bg-green-50 rounded-lg p-4 mb-6 border border-green-200">
          <Text className="font-bold text-green-900 mb-3">
            🚗 Dados do Veículo Selecionado:
          </Text>
          <View className="space-y-1">
            <Text className="text-sm text-green-800">
              Quilometragem atual:{" "}
              {vehicleData.current_mileage?.toLocaleString() || "N/A"} km
            </Text>
            <Text className="text-sm text-green-800">
              Placa: {vehicleData.license_plate || "N/A"}
            </Text>
            <Text className="text-sm text-green-800">
              Modelo: {vehicleData.description || "N/A"}
            </Text>
          </View>
        </View>
      )}

      {/* Loading Vehicle Data */}
      {isLoadingVehicle && (
        <View className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-200">
          <Text className="text-sm text-gray-600 text-center">
            Carregando dados do veículo...
          </Text>
        </View>
      )}

      {/* 📸 Upload Limit Info */}
      <View className="bg-amber-50 rounded-lg p-4 mb-6 border border-amber-200">
        <Text className="font-bold text-amber-900 mb-1">
          📸 Limite de upload total:
        </Text>
        <Text className="text-lg font-bold text-amber-800">5MB</Text>
        <Text className="text-sm text-amber-700 mt-1">
          Soma de todas as fotos do checklist
        </Text>
      </View>

      {/* Form Fields */}
      <View className="gap-4">
        {/* Date */}
        <Controller
          control={control}
          name="checklist_date"
          render={({ field: { onChange, value } }) => (
            <DatePicker
              label="Data do Checklist"
              required
              value={value ? new Date(value) : new Date()}
              onDateChange={(date) => onChange(date.toISOString())}
              error={errors.checklist_date?.message}
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

        {/* Current Mileage Photos - Always Required */}
        {renderPhotoSection("current_mileage", "Foto da Quilometragem")}

        {/* Tires Condition */}
        <Controller
          control={control}
          name="tires_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Condição dos Pneus"
              required
              placeholder="Selecione a condição"
              value={value}
              onValueChange={onChange}
              options={conditionOptions}
              error={errors.tires_condition?.message}
            />
          )}
        />

        {/* Tires Photos - Always Required */}
        {renderPhotoSection("tires_condition", "Foto dos Pneus")}

        {/* Fuel Level */}
        <Controller
          control={control}
          name="fuel_level_adequate"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Nível de Combustível Adequado"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.fuel_level_adequate?.message}
            />
          )}
        />

        {/* Fuel Level Photos - Always Required */}
        {renderPhotoSection(
          "fuel_level_adequate",
          "Foto do Nível de Combustível",
        )}

        {/* Headlights */}
        <Controller
          control={control}
          name="headlights_working"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Faróis Funcionando"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.headlights_working?.message}
            />
          )}
        />

        {/* Headlights Photos - Required if not OK */}
        {renderPhotoSection("headlights_working", "Foto dos Faróis")}

        {/* Taillights */}
        <Controller
          control={control}
          name="taillights_working"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Lanternas Traseiras Funcionando"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.taillights_working?.message}
            />
          )}
        />

        {/* Taillights Photos */}
        {renderPhotoSection(
          "taillights_working",
          "Foto das Lanternas Traseiras",
        )}

        {/* Turn Signals */}
        <Controller
          control={control}
          name="turn_signals_working"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Setas Funcionando"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.turn_signals_working?.message}
            />
          )}
        />

        {/* Turn Signals Photos */}
        {renderPhotoSection("turn_signals_working", "Foto das Setas")}

        {/* Bumpers Condition */}
        <Controller
          control={control}
          name="bumpers_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Condição dos Para-choques"
              required
              placeholder="Selecione a condição"
              value={value}
              onValueChange={onChange}
              options={conditionOptions}
              error={errors.bumpers_condition?.message}
            />
          )}
        />

        {/* Bumpers Photos */}
        {renderPhotoSection("bumpers_condition", "Foto dos Para-choques")}

        {/* Windshield Condition */}
        <Controller
          control={control}
          name="windshield_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Condição do Para-brisa"
              required
              placeholder="Selecione a condição"
              value={value}
              onValueChange={onChange}
              options={conditionOptions}
              error={errors.windshield_condition?.message}
            />
          )}
        />

        {/* Windshield Photos */}
        {renderPhotoSection("windshield_condition", "Foto do Para-brisa")}

        {/* Mirrors Condition */}
        <Controller
          control={control}
          name="mirrors_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Condição dos Retrovisores"
              required
              placeholder="Selecione a condição"
              value={value}
              onValueChange={onChange}
              options={conditionOptions}
              error={errors.mirrors_condition?.message}
            />
          )}
        />

        {/* Mirrors Photos */}
        {renderPhotoSection("mirrors_condition", "Foto dos Retrovisores")}

        {/* Seatbelts Working */}
        <Controller
          control={control}
          name="seatbelts_working"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Cintos de Segurança Funcionando"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.seatbelts_working?.message}
            />
          )}
        />

        {/* Seatbelts Photos */}
        {renderPhotoSection(
          "seatbelts_working",
          "Foto dos Cintos de Segurança",
        )}

        {/* Dashboard Working */}
        <Controller
          control={control}
          name="dashboard_working"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Painel Funcionando"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.dashboard_working?.message}
            />
          )}
        />

        {/* Dashboard Photos */}
        {renderPhotoSection("dashboard_working", "Foto do Painel")}

        {/* Brakes */}
        <Controller
          control={control}
          name="brakes_working"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Freios Funcionando"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.brakes_working?.message}
            />
          )}
        />

        {/* Brakes Photos */}
        {renderPhotoSection("brakes_working", "Foto dos Freios")}

        {/* Clutch Working */}
        <Controller
          control={control}
          name="clutch_working"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Embreagem Funcionando"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.clutch_working?.message}
            />
          )}
        />

        {/* Clutch Photos */}
        {renderPhotoSection("clutch_working", "Foto da Embreagem")}

        {/* Oil Level Adequate */}
        <Controller
          control={control}
          name="oil_level_adequate"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Nível de Óleo Adequado"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.oil_level_adequate?.message}
            />
          )}
        />

        {/* Oil Level Photos */}
        {renderPhotoSection("oil_level_adequate", "Foto do Nível de Óleo")}

        {/* Radiator Water Adequate */}
        <Controller
          control={control}
          name="radiator_water_adequate"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Água do Radiador Adequada"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.radiator_water_adequate?.message}
            />
          )}
        />

        {/* Radiator Water Photos */}
        {renderPhotoSection(
          "radiator_water_adequate",
          "Foto da Água do Radiador",
        )}

        {/* Brake Fluid Adequate */}
        <Controller
          control={control}
          name="brake_fluid_adequate"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Fluido de Freio Adequado"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.brake_fluid_adequate?.message}
            />
          )}
        />

        {/* Brake Fluid Photos */}
        {renderPhotoSection("brake_fluid_adequate", "Foto do Fluido de Freio")}

        {/* Steering Wheel Condition */}
        <Controller
          control={control}
          name="steering_wheel_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Condição do Volante"
              required
              placeholder="Selecione a condição"
              value={value}
              onValueChange={onChange}
              options={conditionOptions}
              error={errors.steering_wheel_condition?.message}
            />
          )}
        />

        {/* Steering Wheel Photos */}
        {renderPhotoSection("steering_wheel_condition", "Foto do Volante")}

        {/* Battery Condition */}
        <Controller
          control={control}
          name="battery_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Condição da Bateria"
              required
              placeholder="Selecione a condição"
              value={value}
              onValueChange={onChange}
              options={conditionOptions}
              error={errors.battery_condition?.message}
            />
          )}
        />

        {/* Battery Photos */}
        {renderPhotoSection("battery_condition", "Foto da Bateria")}

        {/* Driver License Valid */}
        <Controller
          control={control}
          name="driver_license_valid"
          render={({ field: { onChange, value } }) => (
            <Select
              label="CNH Válida"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.driver_license_valid?.message}
            />
          )}
        />

        {/* Vehicle Documents Valid */}
        <Controller
          control={control}
          name="vehicle_documents_valid"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Documentos do Veículo Válidos"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.vehicle_documents_valid?.message}
            />
          )}
        />

        {/* Insurance Valid */}
        <Controller
          control={control}
          name="insurance_valid"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Seguro Válido"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.insurance_valid?.message}
            />
          )}
        />

        {/* Fire Extinguisher Valid */}
        <Controller
          control={control}
          name="fire_extinguisher_valid"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Extintor Válido"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.fire_extinguisher_valid?.message}
            />
          )}
        />

        {/* Warning Triangle Present */}
        <Controller
          control={control}
          name="warning_triangle_present"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Triângulo Presente"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.warning_triangle_present?.message}
            />
          )}
        />

        {/* Jack Present */}
        <Controller
          control={control}
          name="jack_present"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Macaco Presente"
              required
              placeholder="Selecione"
              value={value?.toString()}
              onValueChange={(val) => onChange(val === "true")}
              options={booleanOptions}
              error={errors.jack_present?.message}
            />
          )}
        />

        {/* Spare Tire Condition */}
        <Controller
          control={control}
          name="spare_tire_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Condição do Estepe"
              required
              placeholder="Selecione a condição"
              value={value}
              onValueChange={onChange}
              options={conditionOptions}
              error={errors.spare_tire_condition?.message}
            />
          )}
        />

        {/* Spare Tire Photos */}
        {renderPhotoSection("spare_tire_condition", "Foto do Estepe")}

        {/* Overall Condition */}
        <Controller
          control={control}
          name="overall_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              label="Condição Geral do Veículo"
              required
              placeholder="Selecione a condição geral"
              value={value}
              onValueChange={onChange}
              options={overallConditionOptions}
              error={errors.overall_condition?.message}
            />
          )}
        />

        {/* Notes */}
        <Controller
          control={control}
          name="notes"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Observações (Opcional)"
              placeholder="Digite observações sobre o checklist..."
              value={value || ""}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.notes?.message}
              multiline
              numberOfLines={3}
            />
          )}
        />
      </View>

      {/* Bottom Spacing */}
      <View className="h-32" />
    </View>
  );
};
