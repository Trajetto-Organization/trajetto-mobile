import { useState, useCallback, useEffect, useMemo, useRef } from "react";

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

import { ApiError } from "@/utils/api";
import { checkFuelPermission } from "@/utils/permissions";

import {
  calculateTotalAmount,
  isFuelComplete,
} from "@/features/fuel/fuel-rules";
import { buildFuelDefaults } from "@/features/fuel/fuel-defaults";

import { useImageCapture } from "@/features/media/use-image-capture";
import { useWizardSteps } from "@/features/submissions/use-wizard-steps";
import { useDiscardConfirmation } from "@/features/submissions/use-discard-confirmation";

import { submitOrQueue } from "@/features/submissions/submit-or-queue";
import {
  clearSubmissionId,
  createSubmissionStorageKey,
  getOrCreateSubmissionId,
} from "@/features/submissions/submission-id";

import { useDraftAutosave } from "@/features/submissions/use-draft-autosave";
import {
  clearFuelDraft,
  deleteFuelDraftImage,
  loadFuelDraft,
  persistFuelDraftImage,
  saveFuelDraft,
  type FuelDraft,
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

/** In order; a driver skips straight to the form. */
const FUEL_STEPS = ["branch", "driver", "fuelType", "form"] as const;

type Step = (typeof FUEL_STEPS)[number];

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

  const [stepData, setStepData] = useState<Partial<StepData>>({});

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // The photo now travels on its own leg of the submission, which takes real
  // time on a phone connection — long enough that a bare spinner reads as a
  // hang.
  const [uploadProgress, setUploadProgress] = useState<{
    uploaded: number;
    total: number;
  } | null>(null);
  const [isDraftReady, setIsDraftReady] = useState<boolean>(false);

  const [hasDraft, setHasDraft] = useState<boolean>(false);

  const submissionAbortControllerRef = useRef<AbortController | null>(null);

  const canLeaveStep = useCallback(
    (step: Step) => {
      if (step === "branch") return Boolean(stepData.branchId);
      if (step === "driver") return Boolean(stepData.driverId);
      if (step === "fuelType") return Boolean(stepData.fuelTypeId);

      return false;
    },
    [stepData],
  );

  const {
    currentStep,
    setCurrentStep,
    goToNextStep,
    goToPrevStep,
    canProceedToNext,
  } = useWizardSteps<Step>({
    steps: FUEL_STEPS,
    isCollapsed: isDriver,
    canLeaveStep,
    onExit: router.back,

    // Leaving a step abandons whatever the submission was doing.
    onNavigate: () => submissionAbortControllerRef.current?.abort(),
  });

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
    defaultValues: buildFuelDefaults({
      vehicleId: vehicleId || "",
      businessId: submissionBusinessId,
    }),
  });

  const markDraftPresent = useCallback(() => setHasDraft(true), []);

  const draft = useDraftAutosave<FuelDraft<CreateFuelFormData, StepData>>({
    storageKey: submissionStorageKey,
    isEnabled:
      isDraftReady && Boolean(user?.id && submissionBusinessId && vehicleId),
    save: saveFuelDraft,
    onSchedule: markDraftPresent,
    buildDraft: (submissionId) => ({
      submissionId,
      formData: {
        ...getValues(),

        // A GPS position must be freshly captured for each refuelling, so it is
        // deliberately not carried across app launches.
        latitude: undefined,
        longitude: undefined,
      },
      stepData: stepDataRef.current,
      odometerImage: odometerImageRef.current,
      updatedAt: new Date().toISOString(),
    }),
  });

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

      const endpoint = `/fuel/create-fuel/${submissionBusinessId}`;
      const body: Record<string, unknown> = {};

      let submissionId: string | null = null;

      // Stops the draft autosave from writing the form back to disk after it
      // has been handed off — to the API or to the queue. Both outcomes mean
      // this refuelling is finished work and the form should stop owning it.
      const releaseDraft = () => {
        draft.release();
        setHasDraft(false);
      };

      try {
        submissionId = await getOrCreateSubmissionId(submissionStorageKey);

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
            body[key] = value;
          }
        });

        // Progress stays at full through the request that follows the upload,
        // so the bar reads "saving" instead of vanishing at the moment the
        // driver is watching it finish. The `finally` clears it on every path.
        setUploadProgress({ uploaded: 0, total: 1 });

        const outcome = await submitOrQueue({
          submissionId,
          kind: "fuel",
          endpoint,
          body,
          businessId: submissionBusinessId,
          vehicleId: vehicleId || "",
          vehicleLabel: vehicleData?.license_plate,
          entries: [{ file: odometerImage }],
          uploadType: "odometerPhotos",
          photoField: "photo",
          signal: submissionController.signal,
          onProgress: (uploaded, total) =>
            setUploadProgress({ uploaded, total }),
        });

        // Either way the refuelling has left the form: it is on the server, or
        // it is in the queue with its own copy of the photo.
        releaseDraft();
        void Promise.all([
          clearFuelDraft(submissionStorageKey, submissionId),
          clearSubmissionId(submissionStorageKey),
        ]).catch(() => undefined);

        if (outcome === "sent") {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
            () => undefined,
          );

          void Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["vehicles", submissionBusinessId],
            }),
            queryClient.invalidateQueries({
              queryKey: ["vehicle", submissionBusinessId, vehicleId],
            }),
          ]).catch(() => undefined);
        }

        Toast.show(
          outcome === "sent"
            ? {
                type: "success",
                text1: "Abastecimento criado!",
                text2: "O abastecimento foi registrado com sucesso.",
                position: "top",
                visibilityTime: 3000,
              }
            : {
                type: "info",
                text1: "Abastecimento salvo no aparelho",
                text2: "Será enviado automaticamente quando houver conexão.",
                position: "top",
                visibilityTime: 4000,
              },
        );

        router.replace("/vehicles");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;

        // Anything reaching here is the API refusing on the merits — a mileage
        // below the vehicle's, an inactive branch. The draft stays put so the
        // driver can fix it.
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => undefined);

        Toast.show({
          type: "error",
          text1: "Erro ao criar abastecimento",
          text2:
            error instanceof ApiError
              ? error.message
              : "Ocorreu um erro inesperado. Tente novamente.",
          position: "top",
          visibilityTime: 4000,
        });
      } finally {
        if (submissionAbortControllerRef.current === submissionController) {
          submissionAbortControllerRef.current = null;
        }
        setIsSubmitting(false);
        setUploadProgress(null);
      }
    },
    [
      calculatedTotal,
      draft,
      odometerImage,
      locationData,
      submissionBusinessId,
      submissionStorageKey,
      router,
      queryClient,
      vehicleId,
      vehicleData?.license_plate,
    ],
  );

  useEffect(() => {
    stepDataRef.current = stepData;
  }, [stepData]);

  useEffect(() => {
    odometerImageRef.current = odometerImage;
  }, [odometerImage]);

  // Restores a refuelling left half-filled, and lands the driver back on the
  // step they had reached rather than at the beginning.
  useEffect(() => {
    let isCancelled = false;
    setIsDraftReady(false);
    draft.resume();

    void (async () => {
      if (!user?.id || !submissionBusinessId || !vehicleId) return;

      const storedDraft = await loadFuelDraft<CreateFuelFormData, StepData>(
        submissionStorageKey,
      );

      if (!storedDraft || isCancelled) return;

      reset({
        ...getValues(),
        ...storedDraft.formData,
        vehicleId,
        businessId: submissionBusinessId,
        latitude: undefined,
        longitude: undefined,
      } as unknown as CreateFuelFormData);

      setStepData(storedDraft.stepData);
      setOdometerImage(storedDraft.odometerImage);
      setHasDraft(true);

      if (isDriver || storedDraft.stepData.fuelTypeId) {
        setCurrentStep("form");
      } else if (storedDraft.stepData.driverId) {
        setCurrentStep("fuelType");
      } else if (storedDraft.stepData.branchId) {
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
    // `draft` is stable across renders; re-running this on it would reload the
    // stored draft over the driver's current answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        callback: () => draft.schedule(),
      }),
    [draft, subscribe],
  );

  // The photo and the branch/driver/fuel-type choices live outside the form, so
  // changing them has to trigger a save the form subscription would never see.
  useEffect(() => {
    const hasSelectedContext =
      !isDriver &&
      Boolean(stepData.branchId || stepData.driverId || stepData.fuelTypeId);

    if (!hasDraft && !hasSelectedContext && !odometerImage) return;
    draft.schedule();
  }, [draft, hasDraft, isDriver, odometerImage, stepData]);

  const discardFuelDraft = useCallback(async () => {
    draft.release();
    submissionAbortControllerRef.current?.abort();

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

    draft.resume();
    void getOrCreateSubmissionId(submissionStorageKey).catch(() => undefined);
  }, [
    draft,
    isDriver,
    reset,
    setCurrentStep,
    setValue,
    submissionStorageKey,
    user?.driverId,
    user?.name,
    vehicleData?.branchId,
    vehicleData?.branchName,
    vehicleData?.fuelTypeDescription,
    vehicleData?.fuelTypeId,
  ]);

  const discardConfirmation = useDiscardConfirmation({
    onDiscard: discardFuelDraft,
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

  const areAllRequiredFieldsFilled = useCallback(
    () =>
      isFuelComplete({
        selection: stepData,
        entries: {
          refuelingDate: watchedRefuelingDate,
          mileage: watchedMileage,
          liters: watchedLiters,
          pricePerLiter: watchedPrice,
        },
        isDriver,
        hasOdometerPhoto: Boolean(odometerImage),
        hasLocation: Boolean(locationData),
      }),
    [
      isDriver,
      stepData,
      watchedRefuelingDate,
      watchedMileage,
      watchedLiters,
      watchedPrice,
      odometerImage,
      locationData,
    ],
  );

  /**
   * Replaces the odometer photo with the one just captured.
   *
   * The image arrives already transcoded and within the size limit, so what is
   * left is moving it somewhere the OS will not evict and dropping the one it
   * supersedes — a refuelling carries exactly one.
   */
  const setPreparedOdometerImage = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      let persistedAsset: ImagePicker.ImagePickerAsset | null = null;

      try {
        const submissionId =
          await getOrCreateSubmissionId(submissionStorageKey);

        persistedAsset = persistFuelDraftImage(asset, submissionId);

        // Written straight away rather than through the debounce: a photo is
        // expensive to retake, and the app may not get another chance.
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
            odometerImage: persistedAsset,
            updatedAt: new Date().toISOString(),
          },
        );

        deleteFuelDraftImage(odometerImageRef.current);
        odometerImageRef.current = persistedAsset;

        setOdometerImage(persistedAsset);
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

  const { takePhoto, pickFromGallery } = useImageCapture({
    onCapture: setPreparedOdometerImage,
  });

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
    } catch {
      // Local credentials are cleared regardless; a failed server call must not
      // strand the driver on a screen they asked to leave.
      router.replace("/login");
    }
  }, [logout, router]);

  useEffect(() => {
    const total = calculateTotalAmount(watchedLiters, watchedPrice);
    if (total > 0) setValue("total_amount", total);
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
    uploadProgress,
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
    showDiscardDraftModal: discardConfirmation.isVisible,
    isDiscardingDraft: discardConfirmation.isDiscarding,
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
    requestDiscardDraft: discardConfirmation.request,
    cancelDiscardDraft: discardConfirmation.cancel,
    confirmDiscardDraft: discardConfirmation.confirm,
    confirmLogout,
    handleLocationChange,
    handleLocationLoadingChange,
  };
};
