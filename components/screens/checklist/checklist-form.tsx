import { useState, useEffect } from "react";
import { View, Text } from "react-native";

import { useWatch } from "react-hook-form";

import * as ImagePicker from "expo-image-picker";
import { Input, DatePicker, Select } from "../../ui";

import { ChecklistPhotoSection } from "./checklist-photo-section";
import { AnchoredController, FieldAnchor } from "../../forms/field-anchor";
import type { FieldFocus } from "@/features/forms/use-field-focus";
import { getRequiredPhotoFields, photoFieldKey } from "@/features/checklist/checklist-rules";
import { formatKmReading, formatMileage, parseFormattedValue } from "@/utils/formatters";

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

  /** Where a failed submit scrolls to and focuses (decision 16.700). */
  fieldFocus?: FieldFocus;

  /** Missing-photo messages by photo key, only the ones to show now. */
  photoErrors?: Record<string, string>;

  /** The phone's pre-check warning about the km photo (decision 14.2). */
  mileagePrecheckNotice?: React.ReactNode;
}

const PHOTO_REQUIREMENT_FIELDS = [
  "brakes_working",
  "headlights_working",
  "taillights_working",
  "turn_signals_working",
  "steering_wheel_condition",
  "battery_condition",
  "bumpers_condition",
  "windshield_condition",
  "mirrors_condition",
  "spare_tire_condition",
  "oil_level_adequate",
  "radiator_water_adequate",
  "brake_fluid_adequate",
  "seatbelts_working",
  "dashboard_working",
  "clutch_working",
] as const;

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
  mileagePrecheckNotice,
  fieldFocus,
  photoErrors = {},
}) => {
  const [isFormReady, setIsFormReady] = useState<boolean>(false);

  // Yield one frame so the step transition can paint before mounting the form.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsFormReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Initialize formatted mileage from form values (for back-navigation persistence)
  const [formattedMileage, setFormattedMileage] = useState<string>(() => {
    const mileage = control._formValues?.current_mileage;

    if (mileage && mileage > 0) {
      return mileage.toLocaleString("pt-BR");
    }

    return "";
  });

  // Subscribe only to values that can change a photo requirement. This avoids
  // re-rendering the whole form while typing mileage, notes and other fields.
  const requirementValues = useWatch({
    control,
    name: PHOTO_REQUIREMENT_FIELDS,
    exact: true,
  });
  const formData = Object.fromEntries(
    PHOTO_REQUIREMENT_FIELDS.map((fieldName, index) => [
      fieldName,
      requirementValues[index],
    ]),
  );
  const photoRequirements = getPhotoRequirements(formData);

  // The asterisk follows the same rule as the submit: an unanswered item owes
  // an answer, not a photo; only a recorded defect owes one.
  const requiredPhotos = new Set(getRequiredPhotoFields(formData));

  const renderPhotoSection = (fieldName: string, label: string) => {
    const requirement =
      photoRequirements[fieldName as keyof typeof photoRequirements];

    const images = checklistImages[fieldName] || [];
    const key = photoFieldKey(fieldName);

    return (
      <FieldAnchor name={key} focus={fieldFocus}>
        <ChecklistPhotoSection
          fieldName={fieldName}
          label={label}
          images={images}
          isRequired={requiredPhotos.has(fieldName)}
          reason={requirement?.reason}
          error={photoErrors[key]}
          onImagePicker={onImagePicker}
          onRemoveImage={onRemoveImage}
        />
      </FieldAnchor>
    );
  };

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
        <View className="bg-card rounded-lg p-4 mb-6 border border-border">
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
                {stepData.driverCnh && (
                  <Text className="text-xs text-muted">
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
      <View className="bg-primary-soft rounded-lg p-4 mb-6 border border-primary/40">
        <Text className="font-bold text-primary mb-3">
          ℹ️ Informações importantes:
        </Text>
        <View className="space-y-2">
          <Text className="text-sm text-primary">
            • Informe a quilometragem atual do veículo no momento da inspeção
          </Text>
          <Text className="text-sm text-primary">
            • Fotos são obrigatórias para itens com problemas ou condições
            críticas
          </Text>
          <Text className="text-sm text-primary">
            • Algumas fotos são sempre obrigatórias por questões legais
          </Text>
        </View>
      </View>

      {/* Vehicle Data */}
      {vehicleData && !isLoadingVehicle && (
        <View className="bg-success-soft rounded-lg p-4 mb-6 border border-success/40">
          <Text className="font-bold text-success mb-3">
            🚗 Dados do Veículo Selecionado:
          </Text>
          <View className="space-y-1">
            <Text className="text-sm text-success">
              Quilometragem atual:{" "}
              {formatKmReading(vehicleData.current_mileage) ?? "N/A"} km
            </Text>
            <Text className="text-sm text-success">
              Placa: {vehicleData.license_plate || "N/A"}
            </Text>
            <Text className="text-sm text-success">
              Modelo: {vehicleData.description || "N/A"}
            </Text>
          </View>
        </View>
      )}

      {/* Loading Vehicle Data */}
      {isLoadingVehicle && (
        <View className="bg-subtle rounded-lg p-4 mb-6 border border-border">
          <Text className="text-sm text-muted text-center">
            Carregando dados do veículo...
          </Text>
        </View>
      )}

      {/* 📸 Upload Limit Info */}
      <View className="bg-warning-soft rounded-lg p-4 mb-6 border border-warning/40">
        <Text className="font-bold text-warning mb-1">
          📸 Limite de upload total:
        </Text>
        <Text className="text-lg font-bold text-warning">5MB</Text>
        <Text className="text-sm text-warning mt-1">
          Soma de todas as fotos do checklist
        </Text>
      </View>

      {/* Form Fields */}
      <View className="gap-4">
        {/* Date */}
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="checklist_date"
          render={({ field: { onChange, value } }) => (
            <DatePicker
              label="Data do Checklist"
              required
              value={value ? new Date(value) : new Date()}
              onDateChange={(date) => {
                onChange(date.toISOString());

                // The km rule depends on the date (decision 16.703): a shown
                // km message is re-checked against the new one.
                if (errors.current_mileage) trigger("current_mileage");
              }}
              error={errors.checklist_date?.message}
              maximumDate={new Date()}
            />
          )}
        />

        {/* Current Mileage */}
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="current_mileage"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              testID="checklist-current_mileage"
              inputRef={fieldFocus?.inputRef("current_mileage")}
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
              onBlur={onBlur}
              error={errors.current_mileage?.message}
              keyboardType="numeric"
            />
          )}
        />

        {/* Current Mileage Photos - Always Required */}
        {renderPhotoSection("current_mileage", "Foto da Quilometragem")}
        {mileagePrecheckNotice}

        {/* Tires Condition */}
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="tires_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-tires_condition"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="fuel_level_adequate"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-fuel_level_adequate"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="headlights_working"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-headlights_working"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="taillights_working"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-taillights_working"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="turn_signals_working"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-turn_signals_working"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="bumpers_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-bumpers_condition"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="windshield_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-windshield_condition"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="mirrors_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-mirrors_condition"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="seatbelts_working"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-seatbelts_working"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="dashboard_working"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-dashboard_working"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="brakes_working"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-brakes_working"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="clutch_working"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-clutch_working"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="oil_level_adequate"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-oil_level_adequate"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="radiator_water_adequate"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-radiator_water_adequate"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="brake_fluid_adequate"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-brake_fluid_adequate"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="steering_wheel_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-steering_wheel_condition"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="battery_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-battery_condition"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="driver_license_valid"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-driver_license_valid"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="vehicle_documents_valid"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-vehicle_documents_valid"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="insurance_valid"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-insurance_valid"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="fire_extinguisher_valid"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-fire_extinguisher_valid"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="warning_triangle_present"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-warning_triangle_present"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="jack_present"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-jack_present"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="spare_tire_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-spare_tire_condition"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="overall_condition"
          render={({ field: { onChange, value } }) => (
            <Select
              testID="checklist-overall_condition"
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
        <AnchoredController
          focus={fieldFocus}
          control={control}
          name="notes"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              testID="checklist-notes"
              inputRef={fieldFocus?.inputRef("notes")}
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
