import { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import * as ImagePicker from "expo-image-picker";
import { useCameraPermissions } from "expo-camera";

import { useRouter, useLocalSearchParams } from "expo-router";

import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "../../store";
import { useVehicleData } from "../../hooks";

import { ProtectedRoute } from "../../components/protected-route";
import { Button, ImagePickerBottomSheet } from "../../components/ui";

import { BranchSelection, DriverSelection } from "../../components/shared";
import { ChecklistForm } from "../../components/screens/checklist";

import { createChecklistSchema, CreateChecklistFormData } from "../../schemas";

import apiClient, { ApiError } from "../../utils/api";
import { checkChecklistPermission } from "../../utils/permissions";

interface StepData {
  branchId: string;
  branchName: string;
  driverId: string;
  driverName: string;
  driverCnh: string;
}

interface ChecklistImages {
  [fieldName: string]: ImagePicker.ImagePickerAsset[];
}

type Step = "branch" | "driver" | "form";

const ChecklistScreen = () => {
  const router = useRouter();

  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const { user } = useAuthStore();

  // Check if user is a driver
  const isDriver = user?.role === "BUSINESS_USER" && !!user?.driverId;

  // Drivers start directly at form step (skip branch and driver selection)
  const [currentStep, setCurrentStep] = useState<Step>(
    isDriver ? "form" : "branch",
  );

  const [stepData, setStepData] = useState<Partial<StepData>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [showImagePickerModal, setShowImagePickerModal] =
    useState<boolean>(false);
  const [currentPhotoField, setCurrentPhotoField] = useState<string>("");

  const [checklistImages, setChecklistImages] = useState<ChecklistImages>({});
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const { data: vehicleData, isLoading: isLoadingVehicle } = useVehicleData({
    vehicleId: vehicleId || "",
    businessId: user?.businessId || user?.selectedBusiness || "",
  });

  // Create dynamic schema based on vehicle data
  const createDynamicChecklistSchema = useCallback(() => {
    const baseSchema = createChecklistSchema;

    if (vehicleData?.current_mileage) {
      return baseSchema.extend({
        current_mileage: baseSchema.shape.current_mileage.refine(
          (val) => val > vehicleData.current_mileage,
          {
            message:
              "A quilometragem informada deve ser maior que a quilometragem atual do veículo!",
          },
        ),
      });
    }

    return baseSchema;
  }, [vehicleData?.current_mileage]);

  // Submit form
  const onSubmit: SubmitHandler<CreateChecklistFormData> = useCallback(
    async (data: CreateChecklistFormData) => {
      // Validate required photos based on smart logic
      const formData = new FormData();

      // Add form fields
      Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          formData.append(key, String(value));
        }
      });

      // Add photos with field names
      Object.entries(checklistImages).forEach(([fieldName, images]) => {
        images.forEach((image, index) => {
          const imageFile = {
            uri: image.uri,
            type: "image/jpeg",
            name: `${fieldName}_${Date.now()}_${index}.jpg`,
          } as any;

          formData.append(fieldName, imageFile);
        });
      });

      setIsSubmitting(true);

      try {
        await Promise.all([
          apiClient.postFormData(
            `/vehicle-checklist/create-vehicle-checklist/${user?.businessId}`,
            formData,
          ),
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        ]);

        Toast.show({
          type: "success",
          text1: "Checklist criado!",
          text2: "O checklist veicular foi registrado com sucesso.",
          position: "top",
          visibilityTime: 3000,
        });

        // Navigate back to vehicles
        router.replace("/vehicles");
      } catch (error) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

        let errorMessage = "Ocorreu um erro inesperado. Tente novamente.";
        if (error instanceof ApiError) {
          errorMessage = error.message;
        }

        Toast.show({
          type: "error",
          text1: "Erro ao criar checklist",
          text2: errorMessage,
          position: "top",
          visibilityTime: 4000,
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [checklistImages, user?.businessId, router, stepData],
  );

  // Form setup with corrected default values
  const dynamicSchema = createDynamicChecklistSchema();

  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    trigger,
  } = useForm<CreateChecklistFormData>({
    resolver: zodResolver(dynamicSchema) as any,
    mode: "onChange",
    defaultValues: {
      vehicleId: vehicleId || "",
      businessId: user?.businessId || "",
      checklist_date: new Date().toISOString(),
      current_mileage: undefined,
      notes: "",
      branchId: "",
      driverId: "",
      // Initialize all boolean fields to undefined to force user selection
      headlights_working: undefined,
      taillights_working: undefined,
      turn_signals_working: undefined,
      seatbelts_working: undefined,
      dashboard_working: undefined,
      brakes_working: undefined,
      clutch_working: undefined,
      fuel_level_adequate: undefined,
      oil_level_adequate: undefined,
      radiator_water_adequate: undefined,
      brake_fluid_adequate: undefined,
      driver_license_valid: undefined,
      vehicle_documents_valid: undefined,
      insurance_valid: undefined,
      fire_extinguisher_valid: undefined,
      warning_triangle_present: undefined,
      jack_present: undefined,
      // Initialize condition fields to undefined to force selection
      tires_condition: undefined,
      bumpers_condition: undefined,
      windshield_condition: undefined,
      mirrors_condition: undefined,
      steering_wheel_condition: undefined,
      battery_condition: undefined,
      spare_tire_condition: undefined,
      overall_condition: undefined,
    },
  });

  // Function to check if all required fields are filled
  const areAllRequiredFieldsFilled = useMemo(() => {
    const formData = watch();

    // Check if all step data is filled
    // For drivers: branchId is auto-populated by backend, only check driverId
    if (isDriver) {
      if (!stepData.driverId) {
        return false;
      }
    } else {
      if (!stepData.branchId || !stepData.driverId) {
        return false;
      }
    }

    // Check if all required form fields are filled
    const requiredFields = [
      "checklist_date",
      "current_mileage",
      "tires_condition",
      "headlights_working",
      "taillights_working",
      "turn_signals_working",
      "bumpers_condition",
      "windshield_condition",
      "mirrors_condition",
      "seatbelts_working",
      "dashboard_working",
      "steering_wheel_condition",
      "brakes_working",
      "clutch_working",
      "fuel_level_adequate",
      "oil_level_adequate",
      "radiator_water_adequate",
      "brake_fluid_adequate",
      "battery_condition",
      "driver_license_valid",
      "vehicle_documents_valid",
      "insurance_valid",
      "fire_extinguisher_valid",
      "warning_triangle_present",
      "jack_present",
      "spare_tire_condition",
      "overall_condition",
    ];

    for (const field of requiredFields) {
      const value = formData[field as keyof typeof formData];
      if (value === undefined || value === null || value === "") {
        return false;
      }
    }

    // Check if mileage is greater than 0
    if (!formData.current_mileage || formData.current_mileage <= 0) {
      return false;
    }

    // Check required photos based on backend schema logic
    // LEGAL PROTECTION - Always required photos
    const alwaysRequiredPhotos = [
      "current_mileage",
      "fuel_level_adequate",
      "tires_condition",
    ];

    for (const fieldName of alwaysRequiredPhotos) {
      const images = checklistImages[fieldName] || [];
      if (images.length === 0) {
        return false;
      }
    }

    // CRITICAL SECURITY - Required if not OK
    const conditionalPhotoFields = [
      { field: "brakes_working", condition: !formData.brakes_working },
      { field: "headlights_working", condition: !formData.headlights_working },
      { field: "taillights_working", condition: !formData.taillights_working },
      {
        field: "turn_signals_working",
        condition: !formData.turn_signals_working,
      },
      {
        field: "steering_wheel_condition",
        condition: formData.steering_wheel_condition !== "good",
      },
      {
        field: "battery_condition",
        condition: formData.battery_condition !== "good",
      },
      {
        field: "bumpers_condition",
        condition: formData.bumpers_condition !== "good",
      },
      {
        field: "windshield_condition",
        condition: formData.windshield_condition !== "good",
      },
      {
        field: "mirrors_condition",
        condition: formData.mirrors_condition !== "good",
      },
      {
        field: "spare_tire_condition",
        condition: formData.spare_tire_condition !== "good",
      },

      // VERIFICAÇÕES TÉCNICAS - Required if not OK
      { field: "oil_level_adequate", condition: !formData.oil_level_adequate },
      {
        field: "radiator_water_adequate",
        condition: !formData.radiator_water_adequate,
      },
      {
        field: "brake_fluid_adequate",
        condition: !formData.brake_fluid_adequate,
      },

      // ITENS INTERNOS - Required if not OK
      { field: "seatbelts_working", condition: !formData.seatbelts_working },
      { field: "dashboard_working", condition: !formData.dashboard_working },
      { field: "clutch_working", condition: !formData.clutch_working },
    ];

    for (const { field, condition } of conditionalPhotoFields) {
      if (condition) {
        const images = checklistImages[field] || [];
        if (images.length === 0) {
          return false;
        }
      }
    }

    return true;
  }, [
    isDriver,
    stepData.branchId,
    stepData.driverId,
    watch(),
    checklistImages,
  ]);

  // Navigation callbacks
  const goToNextStep = useCallback(() => {
    // Drivers don't navigate between steps (only form step exists)
    if (isDriver) {
      return;
    }

    const stepOrder: Step[] = ["branch", "driver", "form"];
    const currentIndex = stepOrder.indexOf(currentStep);

    if (currentIndex < stepOrder.length - 1) {
      const nextStep = stepOrder[currentIndex + 1];
      setCurrentStep(nextStep);
    }
  }, [currentStep, isDriver]);

  const goToPrevStep = useCallback(() => {
    // Drivers go back to vehicle list (no previous steps)
    if (isDriver) {
      router.back();
      return;
    }

    const stepOrder: Step[] = ["branch", "driver", "form"];
    const currentIndex = stepOrder.indexOf(currentStep);

    if (currentIndex > 0) {
      const prevStep = stepOrder[currentIndex - 1];
      setCurrentStep(prevStep);
    } else {
      router.back();
    }
  }, [currentStep, router, isDriver]);

  const canProceedToNext = useCallback((): boolean => {
    switch (currentStep) {
      case "branch":
        return !!stepData.branchId;
      case "driver":
        return !!stepData.driverId;
      default:
        return false;
    }
  }, [currentStep, stepData]);

  // Image picker functions
  const requestPermissions = useCallback(async () => {
    const { status: galleryStatus } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    let cameraStatus = "denied";

    if (cameraPermission?.granted) {
      cameraStatus = "granted";
    } else if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      cameraStatus = permission.granted ? "granted" : "denied";
    }

    return cameraStatus === "granted" && galleryStatus === "granted";
  }, [cameraPermission, requestCameraPermission]);

  // Calculate total size of all checklist images
  const getTotalImagesSize = useCallback((): number => {
    let total = 0;
    Object.values(checklistImages).forEach((images) => {
      images.forEach((image) => {
        total += image.fileSize || 0;
      });
    });
    return total;
  }, [checklistImages]);

  // File validation function - validates total size (5MB for all photos combined)
  const validateImageFile = useCallback(
    (asset: ImagePicker.ImagePickerAsset): string | null => {
      const maxTotalSize = 5 * 1024 * 1024; // 5MB total

      const currentTotal = getTotalImagesSize();
      const newTotal = currentTotal + (asset.fileSize || 0);

      if (newTotal > maxTotalSize) {
        const remainingMB = Math.max(
          0,
          (maxTotalSize - currentTotal) / (1024 * 1024),
        ).toFixed(1);

        return `Limite total de 5MB excedido. Espaço restante: ${remainingMB}MB.`;
      }

      return null;
    },
    [getTotalImagesSize],
  );

  const takePhoto = useCallback(async () => {
    const hasPermissions = await requestPermissions();
    if (!hasPermissions) {
      Toast.show({
        type: "error",
        text1: "Permissões necessárias",
        text2: "É necessário permitir acesso à câmera e galeria.",
        position: "top",
      });
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0] && currentPhotoField) {
      const asset = result.assets[0];
      const validationError = validateImageFile(asset);

      if (validationError) {
        Toast.show({
          type: "error",
          text1: "Arquivo muito grande",
          text2: validationError,
          position: "top",
          visibilityTime: 4000,
        });
        return;
      }

      setChecklistImages((prev) => ({
        ...prev,
        [currentPhotoField]: [...(prev[currentPhotoField] || []), asset],
      }));
    }
  }, [requestPermissions, currentPhotoField, validateImageFile]);

  const pickFromGallery = useCallback(async () => {
    const hasPermissions = await requestPermissions();

    if (!hasPermissions) {
      Toast.show({
        type: "error",
        text1: "Permissões necessárias",
        text2: "É necessário permitir acesso à galeria.",
        position: "top",
      });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0] && currentPhotoField) {
      const asset = result.assets[0];
      const validationError = validateImageFile(asset);

      if (validationError) {
        Toast.show({
          type: "error",
          text1: "Arquivo muito grande",
          text2: validationError,
          position: "top",
          visibilityTime: 4000,
        });
        return;
      }

      setChecklistImages((prev) => ({
        ...prev,
        [currentPhotoField]: [...(prev[currentPhotoField] || []), asset],
      }));
    }
  }, [requestPermissions, currentPhotoField, validateImageFile]);

  const showImagePicker = useCallback((fieldName: string) => {
    setCurrentPhotoField(fieldName);
    setShowImagePickerModal(true);
  }, []);

  // 📸 Get friendly title for photo field
  const getPhotoTitle = (fieldName: string): string => {
    const titleMap: Record<string, string> = {
      current_mileage: "Foto do Odômetro",
      fuel_level_adequate: "Foto do Nível de Combustível",
      tires_condition: "Foto dos Pneus",
      brakes_working: "Foto dos Freios",
      headlights_working: "Foto dos Faróis",
      taillights_working: "Foto das Lanternas Traseiras",
      turn_signals_working: "Foto das Setas",
      steering_wheel_condition: "Foto do Volante",
      battery_condition: "Foto da Bateria",
      bumpers_condition: "Foto dos Para-choques",
      windshield_condition: "Foto do Para-brisa",
      mirrors_condition: "Foto dos Retrovisores",
      spare_tire_condition: "Foto do Estepe",
      oil_level_adequate: "Foto do Nível de Óleo",
      radiator_water_adequate: "Foto do Nível de Água do Radiador",
      brake_fluid_adequate: "Foto do Fluido de Freio",
      windshield_washer_fluid_adequate: "Foto do Fluido do Limpador",
      horn_working: "Foto da Buzina",
      seat_belts_working: "Foto dos Cintos de Segurança",
      fire_extinguisher_valid: "Foto do Extintor",
      warning_triangle_present: "Foto do Triângulo",
      first_aid_kit_present: "Foto do Kit de Primeiros Socorros",
      jack_and_tools_present: "Foto do Macaco e Ferramentas",
      vehicle_exterior_condition: "Foto da Condição Externa do Veículo",
      vehicle_interior_condition: "Foto da Condição Interna do Veículo",
    };

    return titleMap[fieldName] || "Foto do Checklist";
  };

  const removeImage = useCallback((fieldName: string, imageIndex: number) => {
    setChecklistImages((prev) => ({
      ...prev,
      [fieldName]: (prev[fieldName] || []).filter(
        (_, index) => index !== imageIndex,
      ),
    }));
  }, []);

  // Auto-fill form when step data changes
  useEffect(() => {
    if (stepData.branchId) {
      setValue("branchId", stepData.branchId);
    }
    if (stepData.driverId) {
      setValue("driverId", stepData.driverId);
    }
  }, [stepData, setValue]);

  // Auto-populate driver and branch data for driver users
  useEffect(() => {
    if (isDriver && user && vehicleData) {
      // Auto-populate all data in a single call to avoid overwriting
      setStepData((prev) => ({
        ...prev,
        // Driver data
        driverId: user.driverId || "",
        driverName: user.name,
        driverCnh: "", // CNH is not available in user data, but will be filled by backend
        // Branch from vehicle (drivers cannot change it)
        branchId: vehicleData.branchId || "",
        branchName: vehicleData.branchName || "",
      }));

      // Set form values - always set driverId for drivers
      setValue("driverId", user.driverId || "");

      // Set branchId if vehicle has one (otherwise backend will use driver's branch)
      if (vehicleData.branchId) {
        setValue("branchId", vehicleData.branchId);
      }
    }
  }, [isDriver, user, vehicleData, setValue]);

  // Check permissions
  const permissions = checkChecklistPermission(user);

  if (!permissions.canWrite) {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 bg-gray-50">
          <View className="flex-1 justify-center items-center px-6">
            <Text className="text-xl font-bold text-gray-900 mb-4 text-center">
              Acesso Negado
            </Text>
            <Text className="text-gray-600 text-center mb-8">
              Você não tem permissão para criar checklists veiculares.
            </Text>
            <Button onPress={() => router.back()}>Voltar</Button>
          </View>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  // Get step title and description
  const getStepInfo = () => {
    const totalSteps = isDriver ? 1 : 3; // 1 step for drivers (only form), 3 for others

    switch (currentStep) {
      case "branch":
        return {
          title: "Selecionar Filial",
          description: "Escolha a filial para o checklist",
          step: 1,
          total: totalSteps,
        };
      case "driver":
        return {
          title: "Selecionar Motorista",
          description: "Escolha o motorista responsável",
          step: 2,
          total: totalSteps,
        };
      case "form":
        return {
          title: "Checklist Veicular",
          description: "Realizar inspeção do veículo",
          step: isDriver ? 1 : 3, // Drivers only have 1 step (form only)
          total: totalSteps,
        };
      default:
        return {
          title: "Checklist Veicular",
          description: "Criar novo checklist",
          step: 1,
          total: totalSteps,
        };
    }
  };

  const stepInfo = getStepInfo();

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-gray-50">
        {/* Step Indicator */}
        <View className="px-6 py-4 bg-white border-b border-gray-200">
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-1">
              <Text className="text-lg font-bold text-gray-900">
                {stepInfo.title}
              </Text>
              <Text className="text-sm text-gray-600">
                {stepInfo.description}
              </Text>
            </View>
            <View className="bg-primary-100 rounded-full px-3 py-1">
              <Text className="text-xs font-medium text-primary-800">
                {stepInfo.step} de {stepInfo.total}
              </Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View className="w-full bg-gray-200 rounded-full h-2">
            <View
              className="bg-primary-500 h-2 rounded-full transition-all"
              style={{ width: `${(stepInfo.step / stepInfo.total) * 100}%` }}
            />
          </View>
        </View>

        {/* Step Content */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {currentStep === "branch" && (
              <BranchSelection
                businessId={user?.businessId || user?.selectedBusiness || ""}
                selectedBranchId={stepData.branchId}
                onSelectBranch={(branch) => {
                  setStepData((prev) => ({
                    ...prev,
                    branchId: branch.id,
                    branchName: branch.corporate_reason,
                  }));
                  setValue("branchId", branch.id);
                }}
              />
            )}

            {currentStep === "driver" && (
              <DriverSelection
                businessId={user?.businessId || user?.selectedBusiness || ""}
                selectedDriverId={stepData.driverId}
                onSelectDriver={(driver) => {
                  setStepData((prev) => ({
                    ...prev,
                    driverId: driver.id,
                    driverName: driver.name,
                    driverCnh: driver.cnh,
                  }));
                  setValue("driverId", driver.id);
                }}
              />
            )}

            {currentStep === "form" && (
              <ChecklistForm
                control={control}
                errors={errors}
                checklistImages={checklistImages}
                onImagePicker={showImagePicker}
                onRemoveImage={removeImage}
                stepData={stepData}
                vehicleData={vehicleData}
                isLoadingVehicle={isLoadingVehicle}
                trigger={trigger}
                isDriver={isDriver}
              />
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Navigation Buttons */}
        <View className="px-6 py-4 bg-white border-t border-gray-200">
          <View className="flex-row gap-4">
            <Button
              onPress={goToPrevStep}
              variant="outline"
              className="flex-1"
              disabled={isSubmitting}
            >
              {currentStep === "branch" ? "Cancelar" : "Voltar"}
            </Button>

            {currentStep === "form" ? (
              <>
                <Button
                  onPress={handleSubmit(onSubmit)}
                  loading={isSubmitting}
                  disabled={
                    isSubmitting ||
                    !areAllRequiredFieldsFilled ||
                    Object.keys(errors).length > 0
                  }
                  className="flex-1"
                >
                  {isSubmitting ? "Criando..." : "Criar Checklist"}
                </Button>
              </>
            ) : (
              <Button
                onPress={goToNextStep}
                disabled={!canProceedToNext()}
                className="flex-1"
              >
                Prosseguir
              </Button>
            )}
          </View>
        </View>

        {/* Image Picker Bottom Sheet */}
        <ImagePickerBottomSheet
          visible={showImagePickerModal}
          onClose={() => setShowImagePickerModal(false)}
          onTakePhoto={takePhoto}
          onPickFromGallery={pickFromGallery}
          title={getPhotoTitle(currentPhotoField)}
          description="Como deseja adicionar a foto?"
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default ChecklistScreen;
