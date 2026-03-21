import { useState, useCallback, useEffect, useMemo } from "react";

import * as ImagePicker from "expo-image-picker";
import { useCameraPermissions } from "expo-camera";

import { useRouter, useLocalSearchParams } from "expo-router";

import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "@/store";
import { useVehicleData } from "@/hooks";

import { createChecklistSchema, CreateChecklistFormData } from "@/schemas";

import { apiClient, ApiError } from "@/utils/api";
import { checkChecklistPermission } from "@/utils/permissions";

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

const PHOTO_TITLE_MAP: Record<string, string> = {
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
  seatbelts_working: "Foto dos Cintos de Segurança",
  dashboard_working: "Foto do Painel",
  clutch_working: "Foto da Embreagem",
  fire_extinguisher_valid: "Foto do Extintor",
  warning_triangle_present: "Foto do Triângulo",
  first_aid_kit_present: "Foto do Kit de Primeiros Socorros",
  jack_and_tools_present: "Foto do Macaco e Ferramentas",
  vehicle_exterior_condition: "Foto da Condição Externa do Veículo",
  vehicle_interior_condition: "Foto da Condição Interna do Veículo",
};

export const useChecklist = () => {
  const router = useRouter();

  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const { user } = useAuthStore();

  const isDriver = user?.role === "BUSINESS_USER" && !!user?.driverId;

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

  const onSubmit: SubmitHandler<CreateChecklistFormData> = useCallback(
    async (data: CreateChecklistFormData) => {
      const formData = new FormData();

      Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          formData.append(key, String(value));
        }
      });

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

  const areAllRequiredFieldsFilled = useMemo(() => {
    const formData = watch();

    if (isDriver) {
      if (!stepData.driverId) return false;
    } else {
      if (!stepData.branchId || !stepData.driverId) return false;
    }

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
      if (value === undefined || value === null || value === "") return false;
    }

    if (!formData.current_mileage || formData.current_mileage <= 0)
      return false;

    const alwaysRequiredPhotos = [
      "current_mileage",
      "fuel_level_adequate",
      "tires_condition",
    ];

    for (const fieldName of alwaysRequiredPhotos) {
      const images = checklistImages[fieldName] || [];
      if (images.length === 0) return false;
    }

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
      { field: "oil_level_adequate", condition: !formData.oil_level_adequate },
      {
        field: "radiator_water_adequate",
        condition: !formData.radiator_water_adequate,
      },
      {
        field: "brake_fluid_adequate",
        condition: !formData.brake_fluid_adequate,
      },
      { field: "seatbelts_working", condition: !formData.seatbelts_working },
      { field: "dashboard_working", condition: !formData.dashboard_working },
      { field: "clutch_working", condition: !formData.clutch_working },
    ];

    for (const { field, condition } of conditionalPhotoFields) {
      if (condition) {
        const images = checklistImages[field] || [];
        if (images.length === 0) return false;
      }
    }

    return true;
  }, [
    isDriver,
    stepData.branchId,
    stepData.driverId,
    checklistImages,
    watch(),
  ]);

  const goToNextStep = useCallback(() => {
    if (isDriver) return;

    const stepOrder: Step[] = ["branch", "driver", "form"];
    const currentIndex = stepOrder.indexOf(currentStep);

    if (currentIndex < stepOrder.length - 1) {
      const nextStep = stepOrder[currentIndex + 1];
      setCurrentStep(nextStep);
    }
  }, [currentStep, isDriver]);

  const goToPrevStep = useCallback(() => {
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

  const getTotalImagesSize = useCallback((): number => {
    let total = 0;

    Object.values(checklistImages).forEach((images) => {
      images.forEach((image) => {
        total += image.fileSize || 0;
      });
    });

    return total;
  }, [checklistImages]);

  const validateImageFile = useCallback(
    (asset: ImagePicker.ImagePickerAsset): string | null => {
      const maxTotalSize = 5 * 1024 * 1024;

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

  const getPhotoTitle = (fieldName: string): string => {
    return PHOTO_TITLE_MAP[fieldName] || "Foto do Checklist";
  };

  const removeImage = useCallback((fieldName: string, imageIndex: number) => {
    setChecklistImages((prev) => ({
      ...prev,
      [fieldName]: (prev[fieldName] || []).filter(
        (_, index) => index !== imageIndex,
      ),
    }));
  }, []);

  useEffect(() => {
    if (stepData.branchId) {
      setValue("branchId", stepData.branchId);
    }

    if (stepData.driverId) {
      setValue("driverId", stepData.driverId);
    }
  }, [stepData, setValue]);

  useEffect(() => {
    if (isDriver && user && vehicleData) {
      setStepData((prev) => ({
        ...prev,
        driverId: user.driverId || "",
        driverName: user.name,
        driverCnh: "",
        branchId: vehicleData.branchId || "",
        branchName: vehicleData.branchName || "",
      }));

      setValue("driverId", user.driverId || "");

      if (vehicleData.branchId) {
        setValue("branchId", vehicleData.branchId);
      }
    }
  }, [isDriver, user, vehicleData, setValue]);

  const permissions = checkChecklistPermission(user);

  const getStepInfo = () => {
    const totalSteps = isDriver ? 1 : 3;

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
          step: isDriver ? 1 : 3,
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

  return {
    user,
    isDriver,
    currentStep,
    stepData,
    setStepData,
    isSubmitting,
    showImagePickerModal,
    setShowImagePickerModal,
    currentPhotoField,
    checklistImages,
    vehicleData,
    isLoadingVehicle,
    control,
    handleSubmit,
    errors,
    setValue,
    trigger,
    permissions,
    stepInfo: getStepInfo(),
    onSubmit,
    goToNextStep,
    goToPrevStep,
    canProceedToNext,
    areAllRequiredFieldsFilled,
    takePhoto,
    pickFromGallery,
    showImagePicker,
    getPhotoTitle,
    removeImage,
  };
};
