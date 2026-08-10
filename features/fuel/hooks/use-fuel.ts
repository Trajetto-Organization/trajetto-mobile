import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";

import * as ImagePicker from "expo-image-picker";

import { useRouter, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "@/store";
import { useVehicleData } from "@/hooks";

import { createFuelSchema, CreateFuelFormData } from "@/schemas";

import { apiClient, ApiError } from "@/utils/api";
import { checkFuelPermission } from "@/utils/permissions";

import {
  createImageFormDataPart,
  getImageValidationError,
  prepareUploadImage,
} from "@/features/media/prepare-image";
import {
  clearSubmissionId,
  createSubmissionStorageKey,
  getOrCreateSubmissionId,
} from "@/features/submissions/submission-id";

import {
  clearFuelDraft,
  deleteFuelDraftImage,
  loadFuelDraft,
  persistFuelDraftImage,
  saveFuelDraft,
} from "@/features/fuel/fuel-draft";

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
  const queryClient = useQueryClient();

  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();

  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const isDriver = user?.role === "BUSINESS_USER" && !!user?.driverId;
  const submissionBusinessId = user?.businessId || "";

  const submissionStorageKey = useMemo(
    () =>
      createSubmissionStorageKey(
        "fuel",
        user?.id || "anonymous",
        submissionBusinessId,
        vehicleId || "unknown-vehicle",
      ),
    [submissionBusinessId, user?.id, vehicleId],
  );

  const [currentStep, setCurrentStep] = useState<Step>(
    isDriver ? "form" : "branch",
  );
  const [stepData, setStepData] = useState<Partial<StepData>>({});

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isDraftReady, setIsDraftReady] = useState<boolean>(false);

  const [hasDraft, setHasDraft] = useState<boolean>(false);
  const [showDiscardDraftModal, setShowDiscardDraftModal] =
    useState<boolean>(false);

  const [isDiscardingDraft, setIsDiscardingDraft] = useState<boolean>(false);
  const discardInFlightRef = useRef<boolean>(false);

  const submissionAbortControllerRef = useRef<AbortController | null>(null);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftPersistenceEnabledRef = useRef<boolean>(true);
  const [showLogoutModal, setShowLogoutModal] = useState<boolean>(false);

  const [showImagePickerModal, setShowImagePickerModal] =
    useState<boolean>(false);
  const [calculatedTotal, setCalculatedTotal] = useState<number>(0);

  const [odometerImage, setOdometerImage] =
    useState<ImagePicker.ImagePickerAsset | null>(null);

  const odometerImageRef = useRef<ImagePicker.ImagePickerAsset | null>(null);
  const stepDataRef = useRef<Partial<StepData>>({});

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
    businessId: submissionBusinessId,
  });

  useEffect(() => {
    if (!user?.id || !submissionBusinessId || !vehicleId) return;
    void getOrCreateSubmissionId(submissionStorageKey).catch(() => undefined);
  }, [submissionBusinessId, submissionStorageKey, user?.id, vehicleId]);

  useEffect(
    () => () => {
      submissionAbortControllerRef.current?.abort();
    },
    [],
  );

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
      submissionAbortControllerRef.current?.abort();
      const submissionController = new AbortController();
      submissionAbortControllerRef.current = submissionController;

      try {
        const formData = new FormData();
        const submissionId =
          await getOrCreateSubmissionId(submissionStorageKey);

        const submissionData = {
          ...data,
          client_submission_id: submissionId,
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

        const imageFile = createImageFormDataPart(
          odometerImage,
          `odometer_${Date.now()}`,
        );

        formData.append("odometer_photo", imageFile);

        await apiClient.postFormData(
          `/fuel/create-fuel/${submissionBusinessId}`,
          formData,
          {
            signal: submissionController.signal,
            headers: { "Idempotency-Key": submissionId },
          },
        );

        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
          () => undefined,
        );
        draftPersistenceEnabledRef.current = false;
        if (draftSaveTimerRef.current) {
          clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
        setHasDraft(false);
        void Promise.all([
          clearFuelDraft(submissionStorageKey, submissionId),
          clearSubmissionId(submissionStorageKey),
        ]).catch(() => undefined);

        void Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["vehicles", submissionBusinessId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["vehicle", submissionBusinessId, vehicleId],
          }),
        ]).catch(() => undefined);

        Toast.show({
          type: "success",
          text1: "Abastecimento criado!",
          text2: "O abastecimento foi registrado com sucesso.",
          position: "top",
          visibilityTime: 3000,
        });

        router.replace("/vehicles");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;

        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => undefined);

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
        if (submissionAbortControllerRef.current === submissionController) {
          submissionAbortControllerRef.current = null;
        }
        setIsSubmitting(false);
      }
    },
    [
      calculatedTotal,
      odometerImage,
      locationData,
      submissionBusinessId,
      submissionStorageKey,
      router,
      queryClient,
      vehicleId,
    ],
  );

  const dynamicSchema = createDynamicFuelSchema();

  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    getValues,
    reset,
    subscribe,
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

  const persistFuelDraft = useCallback(
    async (formData: Partial<CreateFuelFormData>) => {
      if (!isDraftReady || !draftPersistenceEnabledRef.current) return;
      if (!user?.id || !submissionBusinessId || !vehicleId) return;

      const submissionId = await getOrCreateSubmissionId(submissionStorageKey);
      await saveFuelDraft<CreateFuelFormData, StepData>(submissionStorageKey, {
        submissionId,
        formData: {
          ...formData,
          // A GPS position must be freshly captured for each refueling.
          latitude: undefined,
          longitude: undefined,
        },
        stepData: stepDataRef.current,
        odometerImage: odometerImageRef.current,
        updatedAt: new Date().toISOString(),
      });
    },
    [
      isDraftReady,
      submissionBusinessId,
      submissionStorageKey,
      user?.id,
      vehicleId,
    ],
  );

  const scheduleFuelDraftSave = useCallback(
    (formData: Partial<CreateFuelFormData>) => {
      if (!isDraftReady || !draftPersistenceEnabledRef.current) return;
      if (!user?.id || !submissionBusinessId || !vehicleId) return;

      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      setHasDraft(true);
      draftSaveTimerRef.current = setTimeout(() => {
        draftSaveTimerRef.current = null;
        void persistFuelDraft(formData).catch(() => undefined);
      }, 500);
    },
    [isDraftReady, persistFuelDraft, submissionBusinessId, user?.id, vehicleId],
  );

  useEffect(() => {
    stepDataRef.current = stepData;
  }, [stepData]);

  useEffect(() => {
    odometerImageRef.current = odometerImage;
  }, [odometerImage]);

  useEffect(() => {
    let isCancelled = false;
    setIsDraftReady(false);
    draftPersistenceEnabledRef.current = true;

    void (async () => {
      if (!user?.id || !submissionBusinessId || !vehicleId) return;
      const draft = await loadFuelDraft<CreateFuelFormData, StepData>(
        submissionStorageKey,
      );
      if (!draft || isCancelled) return;

      reset({
        ...getValues(),
        ...draft.formData,
        vehicleId,
        businessId: submissionBusinessId,
        latitude: undefined,
        longitude: undefined,
      } as unknown as CreateFuelFormData);
      setStepData(draft.stepData);
      setOdometerImage(draft.odometerImage);
      setHasDraft(true);

      if (isDriver || draft.stepData.fuelTypeId) {
        setCurrentStep("form");
      } else if (draft.stepData.driverId) {
        setCurrentStep("fuelType");
      } else if (draft.stepData.branchId) {
        setCurrentStep("driver");
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (!isCancelled) setIsDraftReady(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [
    getValues,
    isDriver,
    reset,
    submissionBusinessId,
    submissionStorageKey,
    user?.id,
    vehicleId,
  ]);

  useEffect(
    () =>
      subscribe({
        formState: { values: true },
        callback: ({ values }) => scheduleFuelDraftSave(values),
      }),
    [scheduleFuelDraftSave, subscribe],
  );

  useEffect(() => {
    const flushPendingDraft = () => {
      if (!draftSaveTimerRef.current) return;
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
      void persistFuelDraft(getValues()).catch(() => undefined);
    };

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") flushPendingDraft();
    });

    return () => {
      subscription.remove();
      flushPendingDraft();
    };
  }, [getValues, persistFuelDraft]);

  useEffect(() => {
    const hasSelectedContext =
      !isDriver &&
      Boolean(stepData.branchId || stepData.driverId || stepData.fuelTypeId);
    if (!hasDraft && !hasSelectedContext && !odometerImage) return;
    scheduleFuelDraftSave(getValues());
  }, [
    getValues,
    hasDraft,
    isDriver,
    odometerImage,
    scheduleFuelDraftSave,
    stepData,
  ]);

  const discardFuelDraft = useCallback(async () => {
    draftPersistenceEnabledRef.current = false;
    submissionAbortControllerRef.current?.abort();
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }

    const submissionId = await getOrCreateSubmissionId(submissionStorageKey);
    deleteFuelDraftImage(odometerImageRef.current);
    await Promise.all([
      clearFuelDraft(submissionStorageKey, submissionId),
      clearSubmissionId(submissionStorageKey),
    ]);

    reset();
    setOdometerImage(null);
    odometerImageRef.current = null;
    setHasDraft(false);

    if (isDriver) {
      const driverStepData = {
        driverId: user?.driverId || "",
        driverName: user?.name || "",
        driverCnh: "",
        fuelTypeId: vehicleData?.fuelTypeId || "",
        fuelTypeName: vehicleData?.fuelTypeDescription || "",
        branchId: vehicleData?.branchId || "",
        branchName: vehicleData?.branchName || "",
      };
      setStepData(driverStepData);
      stepDataRef.current = driverStepData;
      setValue("driverId", driverStepData.driverId);
      setValue("fuelTypeId", driverStepData.fuelTypeId);
      setValue("branchId", driverStepData.branchId);
      setCurrentStep("form");
    } else {
      setStepData({});
      stepDataRef.current = {};
      setCurrentStep("branch");
    }

    draftPersistenceEnabledRef.current = true;
    void getOrCreateSubmissionId(submissionStorageKey).catch(() => undefined);
  }, [
    isDriver,
    reset,
    setValue,
    submissionStorageKey,
    user?.driverId,
    user?.name,
    vehicleData?.branchId,
    vehicleData?.branchName,
    vehicleData?.fuelTypeDescription,
    vehicleData?.fuelTypeId,
  ]);

  const requestDiscardDraft = useCallback(() => {
    setShowDiscardDraftModal(true);
  }, []);

  const cancelDiscardDraft = useCallback(() => {
    if (!discardInFlightRef.current) setShowDiscardDraftModal(false);
  }, []);

  const confirmDiscardDraft = useCallback(async () => {
    if (discardInFlightRef.current) return;
    discardInFlightRef.current = true;
    setIsDiscardingDraft(true);
    try {
      await discardFuelDraft();
      setShowDiscardDraftModal(false);
    } catch {
      Toast.show({
        type: "error",
        text1: "Não foi possível descartar o rascunho",
        text2: "Tente novamente.",
        position: "top",
      });
    } finally {
      discardInFlightRef.current = false;
      setIsDiscardingDraft(false);
    }
  }, [discardFuelDraft]);

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
    submissionAbortControllerRef.current?.abort();

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

  const setPreparedOdometerImage = useCallback(
    async (selectedAsset: ImagePicker.ImagePickerAsset) => {
      let persistedAsset: ImagePicker.ImagePickerAsset | null = null;
      try {
        let asset = await prepareUploadImage(selectedAsset);
        const validationError = getImageValidationError(asset);

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

        const submissionId =
          await getOrCreateSubmissionId(submissionStorageKey);
        asset = persistFuelDraftImage(asset, submissionId);
        persistedAsset = asset;
        await saveFuelDraft<CreateFuelFormData, StepData>(
          submissionStorageKey,
          {
            submissionId,
            formData: {
              ...getValues(),
              latitude: undefined,
              longitude: undefined,
            },
            stepData: stepDataRef.current,
            odometerImage: asset,
            updatedAt: new Date().toISOString(),
          },
        );
        deleteFuelDraftImage(odometerImageRef.current);
        odometerImageRef.current = asset;
        setOdometerImage(asset);
        setHasDraft(true);
      } catch (error) {
        deleteFuelDraftImage(persistedAsset);
        if (error instanceof Error && error.name === "AbortError") return;
        Toast.show({
          type: "error",
          text1: "Não foi possível preparar a foto",
          text2: "Tente novamente ou selecione outra imagem.",
          position: "top",
        });
      }
    },
    [getValues, submissionStorageKey],
  );

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Toast.show({
        type: "error",
        text1: "Permissão necessária",
        text2: "É necessário permitir acesso à câmera.",
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
      await setPreparedOdometerImage(result.assets[0]);
    }
  }, [setPreparedOdometerImage]);

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Toast.show({
        type: "error",
        text1: "Permissão necessária",
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
      await setPreparedOdometerImage(result.assets[0]);
    }
  }, [setPreparedOdometerImage]);

  const showImagePicker = useCallback(() => {
    setShowImagePickerModal(true);
  }, []);

  const removeOdometerImage = useCallback(() => {
    deleteFuelDraftImage(odometerImageRef.current);
    odometerImageRef.current = null;
    setOdometerImage(null);
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
    removeOdometerImage,
    isDraftReady,
    hasDraft,
    showDiscardDraftModal,
    isDiscardingDraft,
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
    requestDiscardDraft,
    cancelDiscardDraft,
    confirmDiscardDraft,
    confirmLogout,
    handleLocationChange,
    handleLocationLoadingChange,
  };
};
