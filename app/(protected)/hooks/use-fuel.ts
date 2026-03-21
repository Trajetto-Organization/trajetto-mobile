import { useState, useCallback, useEffect } from "react";

import * as ImagePicker from "expo-image-picker";
import { useCameraPermissions } from "expo-camera";

import { useRouter, useLocalSearchParams } from "expo-router";

import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "@/store";
import { useVehicleData } from "@/hooks";

import { createFuelSchema, CreateFuelFormData } from "@/schemas";

import { apiClient, ApiError } from "@/utils/api";
import { checkFuelPermission } from "@/utils/permissions";

interface StepData {
  branchId: string;
  branchName: string;
  driverId: string;
  driverName: string;
  driverCnh: string;
  fuelTypeId: string;
  fuelTypeName: string;
}

type Step = "branch" | "driver" | "fuelType" | "form";

export const useFuel = () => {
  const router = useRouter();

  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const { user, logout } = useAuthStore();

  const isDriver = user?.role === "BUSINESS_USER" && !!user?.driverId;

  const [currentStep, setCurrentStep] = useState<Step>(
    isDriver ? "form" : "branch",
  );
  const [stepData, setStepData] = useState<Partial<StepData>>({});

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);

  const [showImagePickerModal, setShowImagePickerModal] =
    useState<boolean>(false);
  const [calculatedTotal, setCalculatedTotal] = useState<number>(0);

  const [odometerImage, setOdometerImage] =
    useState<ImagePicker.ImagePickerAsset | null>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [locationData, setLocationData] = useState<{
    latitude: number;
    longitude: number;
    wasManuallyAdjusted: boolean;
    originalLatitude?: number;
    originalLongitude?: number;
  } | null>(null);
  const [isLocationLoading, setIsLocationLoading] = useState<boolean>(true);

  const { data: vehicleData, isLoading: isLoadingVehicle } = useVehicleData({
    vehicleId: vehicleId || "",
    businessId: user?.businessId || user?.selectedBusiness || "",
  });

  const createDynamicFuelSchema = useCallback(() => {
    const baseSchema = createFuelSchema;

    if (vehicleData?.current_mileage) {
      return baseSchema.extend({
        current_mileage: baseSchema.shape.current_mileage.refine(
          (val) => val > vehicleData.current_mileage,
          {
            message: `A quilometragem deve ser maior que a atual do veículo (${vehicleData.current_mileage?.toLocaleString()} km).`,
          },
        ),
      });
    }

    return baseSchema;
  }, [vehicleData?.current_mileage]);

  const handleLocationChange = (
    location: {
      latitude: number;
      longitude: number;
      wasManuallyAdjusted: boolean;
      originalLatitude?: number;
      originalLongitude?: number;
    } | null,
  ) => {
    setLocationData(location);
  };

  const handleLocationLoadingChange = (isLoading: boolean) => {
    setIsLocationLoading(isLoading);
  };

  const onSubmit: SubmitHandler<CreateFuelFormData> = useCallback(
    async (data: CreateFuelFormData) => {
      if (!odometerImage) {
        Toast.show({
          type: "error",
          text1: "Foto obrigatória",
          text2: "É necessário adicionar a foto do odômetro.",
          position: "top",
        });

        return;
      }

      if (!locationData) {
        Toast.show({
          type: "error",
          text1: "Localização obrigatória",
          text2: "É necessário capturar a localização GPS.",
          position: "top",
        });

        return;
      }

      setIsSubmitting(true);

      try {
        const formData = new FormData();

        const submissionData = {
          ...data,
          total_amount: calculatedTotal,
          created_from: "MOBILE_APP",
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          ...(locationData.wasManuallyAdjusted && {
            latitude_original: locationData.originalLatitude,
            longitude_original: locationData.originalLongitude,
            location_source: "GPS_MANUAL",
          }),
        };

        Object.entries(submissionData).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            formData.append(key, String(value));
          }
        });

        const imageFile = {
          uri: odometerImage.uri,
          type: "image/jpeg",
          name: `odometer_${Date.now()}.jpg`,
        } as any;

        formData.append("odometer_photo", imageFile);

        await Promise.all([
          apiClient.postFormData(
            `/fuel/create-fuel/${user?.businessId}`,
            formData,
          ),
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        ]);

        Toast.show({
          type: "success",
          text1: "Abastecimento criado!",
          text2: "O abastecimento foi registrado com sucesso.",
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
          text1: "Erro ao criar abastecimento",
          text2: errorMessage,
          position: "top",
          visibilityTime: 4000,
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [calculatedTotal, odometerImage, locationData, user?.businessId, router],
  );

  const dynamicSchema = createDynamicFuelSchema();

  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    trigger,
  } = useForm<CreateFuelFormData>({
    resolver: zodResolver(dynamicSchema) as any,
    mode: "onChange",
    defaultValues: {
      vehicleId: vehicleId || "",
      businessId: user?.businessId || "",
      refueling_date: new Date().toISOString(),
      current_mileage: undefined,
      liters_amount: undefined,
      price_per_liter: undefined,
      total_amount: undefined,
      notes: "",
      branchId: "",
      driverId: "",
      fuelTypeId: "",
      latitude: undefined,
      longitude: undefined,
    },
  });

  const watchedLiters = watch("liters_amount");
  const watchedPrice = watch("price_per_liter");

  const watchedMileage = watch("current_mileage");
  const watchedRefuelingDate = watch("refueling_date");

  useEffect(() => {
    if (locationData) {
      setValue("latitude", locationData.latitude);
      setValue("longitude", locationData.longitude);
    }
  }, [locationData, setValue]);

  const areAllRequiredFieldsFilled = useCallback(() => {
    if (isDriver) {
      return (
        stepData.driverId &&
        watchedRefuelingDate &&
        watchedMileage &&
        watchedLiters &&
        watchedPrice &&
        odometerImage &&
        locationData &&
        watchedMileage > 0 &&
        watchedLiters > 0 &&
        watchedPrice > 0
      );
    }

    return (
      stepData.branchId &&
      stepData.driverId &&
      stepData.fuelTypeId &&
      watchedRefuelingDate &&
      watchedMileage &&
      watchedLiters &&
      watchedPrice &&
      odometerImage &&
      locationData &&
      watchedMileage > 0 &&
      watchedLiters > 0 &&
      watchedPrice > 0
    );
  }, [
    isDriver,
    stepData.branchId,
    stepData.driverId,
    stepData.fuelTypeId,
    watchedRefuelingDate,
    watchedMileage,
    watchedLiters,
    watchedPrice,
    odometerImage,
    locationData,
  ]);

  const goToNextStep = useCallback(() => {
    if (isDriver) return;

    const stepOrder: Step[] = ["branch", "driver", "fuelType", "form"];
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

    const stepOrder: Step[] = ["branch", "driver", "fuelType", "form"];
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
      case "fuelType":
        return !!stepData.fuelTypeId;
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

  const validateImageFile = useCallback(
    (asset: ImagePicker.ImagePickerAsset): string | null => {
      const maxSize = 5 * 1024 * 1024;

      if (asset.fileSize && asset.fileSize > maxSize) {
        return "O arquivo deve ter no máximo 5MB.";
      }

      return null;
    },
    [],
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

    if (!result.canceled && result.assets[0]) {
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

      setOdometerImage(asset);
    }
  }, [requestPermissions, validateImageFile]);

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

    if (!result.canceled && result.assets[0]) {
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

      setOdometerImage(asset);
    }
  }, [requestPermissions, validateImageFile]);

  const showImagePicker = useCallback(() => {
    setShowImagePickerModal(true);
  }, []);

  const confirmLogout = useCallback(async () => {
    try {
      await logout();
      router.replace("/login");
    } catch (error) {}
  }, [logout, router]);

  useEffect(() => {
    if (
      watchedLiters &&
      watchedPrice &&
      watchedLiters > 0 &&
      watchedPrice > 0
    ) {
      const total = watchedLiters * watchedPrice;
      setValue("total_amount", total);
    }
  }, [watchedLiters, watchedPrice, setValue]);

  useEffect(() => {
    if (isDriver && user && vehicleData) {
      setStepData((prev) => ({
        ...prev,
        driverId: user.driverId || "",
        driverName: user.name,
        driverCnh: "",
        fuelTypeId: vehicleData.fuelTypeId || "",
        fuelTypeName: vehicleData.fuelTypeDescription || "",
        branchId: vehicleData.branchId || "",
        branchName: vehicleData.branchName || "",
      }));

      setValue("driverId", user.driverId || "");
      setValue("fuelTypeId", vehicleData.fuelTypeId || "");

      if (vehicleData.branchId) {
        setValue("branchId", vehicleData.branchId);
      }
    }
  }, [isDriver, user, vehicleData, setValue]);

  const permissions = checkFuelPermission(user);

  const getStepInfo = () => {
    const totalSteps = isDriver ? 1 : 4;

    switch (currentStep) {
      case "branch":
        return {
          title: "Selecionar Filial",
          description: "Escolha a filial para o abastecimento",
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
      case "fuelType":
        return {
          title: "Tipo de Combustível",
          description: "Escolha o tipo de combustível",
          step: 3,
          total: totalSteps,
        };
      case "form":
        return {
          title: "Dados do Abastecimento",
          description: "Insira as informações do abastecimento",
          step: isDriver ? 1 : 4,
          total: totalSteps,
        };
      default:
        return {
          title: "Abastecimento",
          description: "Criar novo abastecimento",
          step: 1,
          total: totalSteps,
        };
    }
  };

  return {
    user,
    vehicleId,
    isDriver,
    currentStep,
    stepData,
    setStepData,
    isSubmitting,
    showLogoutModal,
    setShowLogoutModal,
    showImagePickerModal,
    setShowImagePickerModal,
    calculatedTotal,
    setCalculatedTotal,
    odometerImage,
    setOdometerImage,
    isLocationLoading,
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
    confirmLogout,
    handleLocationChange,
    handleLocationLoadingChange,
  };
};
