import { useState, useCallback, useEffect } from "react";
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

import {
  Button,
  LogoutModal,
  ImagePickerBottomSheet,
} from "../../components/ui";

import {
  BranchSelection,
  DriverSelection,
  FuelTypeSelection,
} from "../../components/shared";

import { FuelForm } from "../../components/screens/fuel";

import { createFuelSchema, CreateFuelFormData } from "../../schemas";

import apiClient, { ApiError } from "../../utils/api";
import { checkFuelPermission } from "../../utils/permissions";

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

const FuelScreen = () => {
  const router = useRouter();

  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const { user, logout } = useAuthStore();

  // Check if user is a driver
  const isDriver = user?.role === "BUSINESS_USER" && !!user?.driverId;

  // Drivers start directly at form step (skip branch, driver, fuelType)
  const [currentStep, setCurrentStep] = useState<Step>(
    isDriver ? "form" : "branch"
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

  const { data: vehicleData, isLoading: isLoadingVehicle } = useVehicleData({
    vehicleId: vehicleId || "",
    businessId: user?.businessId || "",
  });

  // Create dynamic schema based on vehicle data
  const createDynamicFuelSchema = useCallback(() => {
    const baseSchema = createFuelSchema;

    if (vehicleData?.current_mileage) {
      return baseSchema.extend({
        current_mileage: baseSchema.shape.current_mileage.refine(
          (val) => val > vehicleData.current_mileage,
          {
            message: `A quilometragem deve ser maior que a atual do veículo (${vehicleData.current_mileage?.toLocaleString()} km).`,
          }
        ),
      });
    }

    return baseSchema;
  }, [vehicleData?.current_mileage]);

  // Submit form - moved before useForm to avoid conditional hook call
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

      setIsSubmitting(true);

      try {
        // Create FormData for multipart upload
        const formData = new FormData();

        // Add form fields (including calculated total)
        const submissionData = {
          ...data,
          total_amount: calculatedTotal,
        };

        Object.entries(submissionData).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            formData.append(key, String(value));
          }
        });

        // Add image file
        const imageFile = {
          uri: odometerImage.uri,
          type: "image/jpeg",
          name: `odometer_${Date.now()}.jpg`,
        } as any;

        formData.append("odometer_photo", imageFile);

        await Promise.all([
          apiClient.postFormData(
            `/fuel/create-fuel/${user?.businessId}`,
            formData
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
          text1: "Erro ao criar abastecimento",
          text2: errorMessage,
          position: "top",
          visibilityTime: 4000,
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [calculatedTotal, odometerImage, user?.businessId, router]
  );

  // Form setup with corrected default values
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
    mode: "onChange", // Real-time validation
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
    },
  });

  // Watch form values
  const watchedLiters = watch("liters_amount");
  const watchedPrice = watch("price_per_liter");

  const watchedMileage = watch("current_mileage");
  const watchedRefuelingDate = watch("refueling_date");

  // Function to check if all required fields are filled
  const areAllRequiredFieldsFilled = useCallback(() => {
    // For drivers: branchId and fuelTypeId are auto-populated by backend, only check driver and form fields
    if (isDriver) {
      return (
        stepData.driverId &&
        watchedRefuelingDate &&
        watchedMileage &&
        watchedLiters &&
        watchedPrice &&
        odometerImage &&
        watchedMileage > 0 &&
        watchedLiters > 0 &&
        watchedPrice > 0
      );
    }

    // For non-drivers: check all fields including branchId and fuelTypeId
    return (
      stepData.branchId &&
      stepData.driverId &&
      stepData.fuelTypeId &&
      watchedRefuelingDate &&
      watchedMileage &&
      watchedLiters &&
      watchedPrice &&
      odometerImage &&
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
  ]);

  // All useCallback hooks at the top level
  const goToNextStep = useCallback(() => {
    // Drivers don't navigate between steps (only form step exists)
    if (isDriver) {
      return;
    }

    const stepOrder: Step[] = ["branch", "driver", "fuelType", "form"];
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

  // File validation function
  const validateImageFile = useCallback(
    (asset: ImagePicker.ImagePickerAsset): string | null => {
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (asset.fileSize && asset.fileSize > maxSize) {
        return "O arquivo deve ter no máximo 5MB.";
      }

      return null;
    },
    []
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

  // Calculate total automatically
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

  // Auto-populate driver, branch, and fuel type data for driver users
  useEffect(() => {
    if (isDriver && user && vehicleData) {
      // Auto-populate all data in a single call to avoid overwriting
      setStepData((prev) => ({
        ...prev,
        // Driver data
        driverId: user.driverId || "",
        driverName: user.name,
        driverCnh: "", // CNH is not available in user data, but will be filled by backend
        // Fuel type from vehicle (drivers cannot change it)
        fuelTypeId: vehicleData.fuelTypeId || "",
        fuelTypeName: vehicleData.fuelTypeDescription || "",
        // Branch from vehicle (drivers cannot change it)
        branchId: vehicleData.branchId || "",
        branchName: vehicleData.branchName || "",
      }));

      // Set form values - always set fuelTypeId and driverId for drivers
      setValue("driverId", user.driverId || "");
      setValue("fuelTypeId", vehicleData.fuelTypeId || "");

      // Set branchId if vehicle has one (otherwise backend will use driver's branch)
      if (vehicleData.branchId) {
        setValue("branchId", vehicleData.branchId);
      }
    }
  }, [isDriver, user, vehicleData, setValue]);

  // Check permissions
  const permissions = checkFuelPermission(user);
  if (!permissions.canWrite) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 justify-center items-center px-6">
          <Text className="text-xl font-bold text-gray-900 mb-4 text-center">
            Acesso negado
          </Text>
          <Text className="text-gray-600 text-center mb-8">
            Você não tem permissão para criar abastecimentos.
          </Text>
          <Button onPress={() => router.back()} variant="primary">
            Voltar
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  // Get step title and description
  const getStepInfo = () => {
    const totalSteps = isDriver ? 1 : 4; // 1 step for drivers (only form), 4 steps for others

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
          step: isDriver ? 1 : 4, // Drivers only have 1 step (form only)
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
                businessId={user?.businessId || ""}
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
                businessId={user?.businessId || ""}
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

            {currentStep === "fuelType" && (
              <FuelTypeSelection
                businessId={user?.businessId || ""}
                selectedFuelTypeId={stepData.fuelTypeId}
                onSelectFuelType={(fuelType) => {
                  setStepData((prev) => ({
                    ...prev,
                    fuelTypeId: fuelType.id,
                    fuelTypeName: fuelType.description,
                  }));
                  setValue("fuelTypeId", fuelType.id);
                }}
              />
            )}

            {currentStep === "form" && (
              <FuelForm
                control={control}
                errors={errors}
                odometerImage={odometerImage}
                onImagePicker={showImagePicker}
                onRemoveImage={() => setOdometerImage(null)}
                stepData={stepData}
                calculatedTotal={calculatedTotal}
                onTotalChange={setCalculatedTotal}
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
              <Button
                onPress={handleSubmit(onSubmit)}
                loading={isSubmitting}
                disabled={isSubmitting || !areAllRequiredFieldsFilled()}
                className="flex-1"
              >
                {isSubmitting ? "Criando..." : "Abastecer"}
              </Button>
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

        {/* Logout Modal */}
        <LogoutModal
          visible={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={confirmLogout}
        />

        {/* Image Picker Bottom Sheet */}
        <ImagePickerBottomSheet
          visible={showImagePickerModal}
          onClose={() => setShowImagePickerModal(false)}
          onTakePhoto={takePhoto}
          onPickFromGallery={pickFromGallery}
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default FuelScreen;
