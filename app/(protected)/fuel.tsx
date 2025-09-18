import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Camera from "expo-camera";

import { useRouter, useLocalSearchParams } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "../../store";
import {
  useBranchInfiniteScroll,
  useDriverInfiniteScroll,
  useFuelTypeInfiniteScroll,
} from "../../hooks";

import { ProtectedRoute } from "../../components/protected-route";

import {
  LoadingSpinner,
  Button,
  Input,
  DatePicker,
  LogoutModal,
} from "../../components/ui";

import { createFuelSchema, CreateFuelFormData } from "../../schemas";
import apiClient, { ApiError } from "../../utils/api";
import { checkFuelPermission } from "../../utils/permissions";

// Import the specific hook types
import type { Branch } from "../../hooks/use-branch-infinite-scroll";
import type { Driver } from "../../hooks/use-driver-infinite-scroll";
import type { FuelType } from "../../hooks/use-fuel-type-infinite-scroll";

// Types
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

  // States
  const [currentStep, setCurrentStep] = useState<Step>("branch");
  const [stepData, setStepData] = useState<Partial<StepData>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);
  const [odometerImage, setOdometerImage] =
    useState<ImagePicker.ImagePickerAsset | null>(null);

  // Form setup
  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<CreateFuelFormData>({
    resolver: zodResolver(createFuelSchema),
    defaultValues: {
      vehicleId: vehicleId || "",
      businessId: user?.businessId || "",
      refueling_date: new Date().toISOString(),
      current_mileage: 0,
      liters_amount: 0,
      price_per_liter: 0,
      notes: "",
      branchId: "",
      driverId: "",
      fuelTypeId: "",
    },
  });

  // Watch form values
  const watchedLiters = watch("liters_amount");
  const watchedPrice = watch("price_per_liter");

  // Calculate total automatically
  useEffect(() => {
    if (watchedLiters && watchedPrice) {
      const total = watchedLiters * watchedPrice;
      setValue("total_amount", total);
    }
  }, [watchedLiters, watchedPrice, setValue]);

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

  // Step navigation
  const goToNextStep = useCallback(() => {
    const stepOrder: Step[] = ["branch", "driver", "fuelType", "form"];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex < stepOrder.length - 1) {
      setCurrentStep(stepOrder[currentIndex + 1]);
    }
  }, [currentStep]);

  const goToPrevStep = useCallback(() => {
    const stepOrder: Step[] = ["branch", "driver", "fuelType", "form"];
    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(stepOrder[currentIndex - 1]);
    } else {
      router.back();
    }
  }, [currentStep, router]);

  // Image picker functions
  const requestPermissions = async () => {
    const { status: cameraStatus } =
      await Camera.requestCameraPermissionsAsync();
    const { status: galleryStatus } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    return cameraStatus === "granted" && galleryStatus === "granted";
  };

  const showImagePicker = () => {
    Alert.alert("Foto do Odômetro", "Como deseja adicionar a foto?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Câmera", onPress: takePhoto },
      { text: "Galeria", onPress: pickFromGallery },
    ]);
  };

  const takePhoto = async () => {
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
      setOdometerImage(result.assets[0]);
    }
  };

  const pickFromGallery = async () => {
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
      setOdometerImage(result.assets[0]);
    }
  };

  // Submit form
  const onSubmit = async (data: CreateFuelFormData) => {
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

      // Add form fields
      Object.entries(data).forEach(([key, value]) => {
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

      const response = await apiClient.postFormData(
        `/fuel/create-fuel/${user?.businessId}`,
        formData
      );

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

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
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = async () => {
    try {
      await logout();
      router.replace("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  // Get step title and description
  const getStepInfo = () => {
    switch (currentStep) {
      case "branch":
        return {
          title: "Selecionar Filial",
          description: "Escolha a filial para o abastecimento",
          step: 1,
          total: 4,
        };
      case "driver":
        return {
          title: "Selecionar Motorista",
          description: "Escolha o motorista responsável",
          step: 2,
          total: 4,
        };
      case "fuelType":
        return {
          title: "Tipo de Combustível",
          description: "Escolha o tipo de combustível",
          step: 3,
          total: 4,
        };
      case "form":
        return {
          title: "Dados do Abastecimento",
          description: "Insira as informações do abastecimento",
          step: 4,
          total: 4,
        };
      default:
        return {
          title: "Abastecimento",
          description: "Criar novo abastecimento",
          step: 1,
          total: 4,
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
        <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1 }}>
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
            />
          )}
        </ScrollView>

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
                disabled={isSubmitting || !odometerImage}
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
      </SafeAreaView>
    </ProtectedRoute>
  );

  function canProceedToNext(): boolean {
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
  }
};

// Branch Selection Component
const BranchSelection: React.FC<{
  businessId: string;
  selectedBranchId?: string;
  onSelectBranch: (branch: Branch) => void;
}> = ({ businessId, selectedBranchId, onSelectBranch }) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const {
    branches,
    isLoading,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useBranchInfiniteScroll(debouncedSearch || undefined);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isLoading) {
      loadMore();
    }
  }, [hasNextPage, isLoading, loadMore]);

  if (isError) {
    return (
      <View className="flex-1 justify-center items-center px-6">
        <Text className="text-xl font-bold text-gray-900 mb-4 text-center">
          Erro ao carregar filiais
        </Text>
        <Text className="text-gray-600 text-center mb-8">{error}</Text>
        <Button onPress={handleRefresh}>Tentar novamente</Button>
      </View>
    );
  }

  return (
    <View className="flex-1 px-6 pt-6">
      {/* Search Input */}
      <View className="mb-6">
        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Buscar filial por nome..."
          className="bg-white border-gray-200 rounded-2xl"
          rightIcon={
            searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close" size={18} color="#6b7280" />
              </TouchableOpacity>
            ) : (
              <Ionicons name="search" size={18} color="#9ca3af" />
            )
          }
        />
      </View>

      {/* Selected Branch Indicator */}
      {selectedBranchId && (
        <View className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
          <Text className="text-sm text-green-800 font-medium">
            ✓ Filial selecionada
          </Text>
        </View>
      )}

      {/* Branch List */}
      {isLoading ? (
        <LoadingSpinner text="Carregando filiais..." />
      ) : branches.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-600 text-center">
            Nenhuma filial encontrada
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScrollEndDrag={handleLoadMore}
        >
          {branches.map((branch) => (
            <TouchableOpacity
              key={branch.id}
              onPress={() => onSelectBranch(branch)}
              className={`bg-white rounded-lg p-4 mb-3 border ${
                selectedBranchId === branch.id
                  ? "border-primary-500 bg-primary-50"
                  : "border-gray-200"
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-bold text-gray-900 mb-1">
                    {branch.corporate_reason}
                  </Text>
                  {branch.fantasy_name && (
                    <Text className="text-sm text-gray-600 mb-2">
                      {branch.fantasy_name}
                    </Text>
                  )}
                  <Text className="text-xs text-gray-500">
                    {branch.city}, {branch.uf}
                  </Text>
                </View>
                {selectedBranchId === branch.id && (
                  <View className="w-6 h-6 bg-primary-500 rounded-full items-center justify-center">
                    <Ionicons name="checkmark" size={16} color="white" />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

// Driver Selection Component
const DriverSelection: React.FC<{
  businessId: string;
  selectedDriverId?: string;
  onSelectDriver: (driver: Driver) => void;
}> = ({ businessId, selectedDriverId, onSelectDriver }) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { drivers, isLoading, isError, error, hasNextPage, loadMore, refetch } =
    useDriverInfiniteScroll(debouncedSearch || undefined);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isLoading) {
      loadMore();
    }
  }, [hasNextPage, isLoading, loadMore]);

  if (isError) {
    return (
      <View className="flex-1 justify-center items-center px-6">
        <Text className="text-xl font-bold text-gray-900 mb-4 text-center">
          Erro ao carregar motoristas
        </Text>
        <Text className="text-gray-600 text-center mb-8">{error}</Text>
        <Button onPress={handleRefresh}>Tentar novamente</Button>
      </View>
    );
  }

  return (
    <View className="flex-1 px-6 pt-6">
      {/* Search Input */}
      <View className="mb-6">
        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Buscar motorista por nome ou CNH..."
          className="bg-white border-gray-200 rounded-2xl"
          rightIcon={
            searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close" size={18} color="#6b7280" />
              </TouchableOpacity>
            ) : (
              <Ionicons name="search" size={18} color="#9ca3af" />
            )
          }
        />
      </View>

      {/* Selected Driver Indicator */}
      {selectedDriverId && (
        <View className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
          <Text className="text-sm text-green-800 font-medium">
            ✓ Motorista selecionado
          </Text>
        </View>
      )}

      {/* Driver List */}
      {isLoading ? (
        <LoadingSpinner text="Carregando motoristas..." />
      ) : drivers.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-600 text-center">
            Nenhum motorista encontrado
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScrollEndDrag={handleLoadMore}
        >
          {drivers.map((driver) => (
            <TouchableOpacity
              key={driver.id}
              onPress={() => onSelectDriver(driver)}
              className={`bg-white rounded-lg p-4 mb-3 border ${
                selectedDriverId === driver.id
                  ? "border-primary-500 bg-primary-50"
                  : "border-gray-200"
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-bold text-gray-900 mb-1">
                    {driver.name}
                  </Text>
                  <Text className="text-sm text-gray-600 mb-1">
                    CNH: {driver.cnh}
                  </Text>
                  <Text className="text-xs text-gray-500">
                    {driver.city}, {driver.uf}
                  </Text>
                </View>
                {selectedDriverId === driver.id && (
                  <View className="w-6 h-6 bg-primary-500 rounded-full items-center justify-center">
                    <Ionicons name="checkmark" size={16} color="white" />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

// Fuel Type Selection Component
const FuelTypeSelection: React.FC<{
  businessId: string;
  selectedFuelTypeId?: string;
  onSelectFuelType: (fuelType: FuelType) => void;
}> = ({ businessId, selectedFuelTypeId, onSelectFuelType }) => {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const {
    fuelTypes,
    isLoading,
    isError,
    error,
    hasNextPage,
    loadMore,
    refetch,
  } = useFuelTypeInfiniteScroll(debouncedSearch || undefined);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isLoading) {
      loadMore();
    }
  }, [hasNextPage, isLoading, loadMore]);

  if (isError) {
    return (
      <View className="flex-1 justify-center items-center px-6">
        <Text className="text-xl font-bold text-gray-900 mb-4 text-center">
          Erro ao carregar tipos de combustível
        </Text>
        <Text className="text-gray-600 text-center mb-8">{error}</Text>
        <Button onPress={handleRefresh}>Tentar novamente</Button>
      </View>
    );
  }

  return (
    <View className="flex-1 px-6 pt-6">
      {/* Search Input */}
      <View className="mb-6">
        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Buscar tipo de combustível..."
          className="bg-white border-gray-200 rounded-2xl"
          rightIcon={
            searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close" size={18} color="#6b7280" />
              </TouchableOpacity>
            ) : (
              <Ionicons name="search" size={18} color="#9ca3af" />
            )
          }
        />
      </View>

      {/* Selected Fuel Type Indicator */}
      {selectedFuelTypeId && (
        <View className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
          <Text className="text-sm text-green-800 font-medium">
            ✓ Tipo de combustível selecionado
          </Text>
        </View>
      )}

      {/* Fuel Type List */}
      {isLoading ? (
        <LoadingSpinner text="Carregando tipos de combustível..." />
      ) : fuelTypes.length === 0 ? (
        <View className="flex-1 justify-center items-center">
          <Text className="text-gray-600 text-center">
            Nenhum tipo de combustível encontrado
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          onScrollEndDrag={handleLoadMore}
        >
          {fuelTypes.map((fuelType) => (
            <TouchableOpacity
              key={fuelType.id}
              onPress={() => onSelectFuelType(fuelType)}
              className={`bg-white rounded-lg p-4 mb-3 border ${
                selectedFuelTypeId === fuelType.id
                  ? "border-primary-500 bg-primary-50"
                  : "border-gray-200"
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="font-bold text-gray-900">
                    {fuelType.description}
                  </Text>
                </View>
                {selectedFuelTypeId === fuelType.id && (
                  <View className="w-6 h-6 bg-primary-500 rounded-full items-center justify-center">
                    <Ionicons name="checkmark" size={16} color="white" />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

// Fuel Form Component
const FuelForm: React.FC<{
  control: any;
  errors: any;
  odometerImage: ImagePicker.ImagePickerAsset | null;
  onImagePicker: () => void;
  onRemoveImage: () => void;
  stepData: Partial<StepData>;
}> = ({
  control,
  errors,
  odometerImage,
  onImagePicker,
  onRemoveImage,
  stepData,
}) => {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1"
    >
      <ScrollView className="flex-1 px-6 pt-6">
        {/* Selected Items Summary */}
        <View className="bg-white rounded-lg p-4 mb-6 border border-gray-200">
          <Text className="font-bold text-gray-900 mb-3">
            📋 Resumo da Seleção
          </Text>

          <View className="space-y-2">
            <View className="flex-row">
              <Text className="text-sm text-gray-600 w-20">Filial:</Text>
              <Text className="text-sm text-gray-900 flex-1 font-medium">
                {stepData.branchName || "N/A"}
              </Text>
            </View>

            <View className="flex-row">
              <Text className="text-sm text-gray-600 w-20">Motorista:</Text>
              <Text className="text-sm text-gray-900 flex-1 font-medium">
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
              <Text className="text-sm text-gray-600 w-20">Combustível:</Text>
              <Text className="text-sm text-gray-900 flex-1 font-medium">
                {stepData.fuelTypeName || "N/A"}
              </Text>
            </View>
          </View>
        </View>

        {/* Form Fields */}
        <View className="space-y-6">
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
                placeholder="Ex: 50000"
                value={value?.toString() || ""}
                onChangeText={(text) => {
                  const numValue = parseFloat(text.replace(/[^0-9.]/g, ""));
                  onChange(isNaN(numValue) ? 0 : numValue);
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
                placeholder="Ex: 45.5"
                value={value?.toString() || ""}
                onChangeText={(text) => {
                  const numValue = parseFloat(text.replace(/[^0-9.]/g, ""));
                  onChange(isNaN(numValue) ? 0 : numValue);
                }}
                onBlur={onBlur}
                error={errors.liters_amount?.message}
                keyboardType="phone-pad"
              />
            )}
          />

          {/* Price per Liter */}
          <Controller
            control={control}
            name="price_per_liter"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Preço por Litro (R$)"
                placeholder="Ex: 5.99"
                value={value?.toString() || ""}
                onChangeText={(text) => {
                  const numValue = parseFloat(text.replace(/[^0-9.]/g, ""));
                  onChange(isNaN(numValue) ? 0 : numValue);
                }}
                onBlur={onBlur}
                error={errors.price_per_liter?.message}
                keyboardType="phone-pad"
              />
            )}
          />

          {/* Total Amount (Calculated) */}
          <Controller
            control={control}
            name="total_amount"
            render={({ field: { value } }) => (
              <View>
                <Text className="text-gray-700 font-medium mb-2">
                  Valor Total (R$)
                </Text>
                <View className="border rounded-lg px-3 py-3 bg-gray-50">
                  <Text className="text-lg font-bold text-primary-600">
                    R$ {value?.toFixed(2).replace(".", ",") || "0,00"}
                  </Text>
                </View>
                <Text className="text-xs text-gray-500 mt-1">
                  Calculado automaticamente
                </Text>
              </View>
            )}
          />

          {/* Odometer Photo */}
          <View>
            <Text className="text-gray-700 font-medium mb-2">
              Foto do Odômetro <Text className="text-red-500">*</Text>
            </Text>

            {odometerImage ? (
              <View className="border border-green-300 rounded-lg p-3 bg-green-50">
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
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 items-center"
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

          {/* Notes */}
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
                numberOfLines={3}
              />
            )}
          />
        </View>

        {/* Bottom Spacing */}
        <View className="h-8" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default FuelScreen;
