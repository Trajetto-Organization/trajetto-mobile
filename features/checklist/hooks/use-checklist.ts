import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";

import * as ImagePicker from "expo-image-picker";

import { useRouter, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useForm, useWatch, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "@/store";
import { useVehicleData } from "@/hooks";

import { createChecklistSchema, CreateChecklistFormData } from "@/schemas";

import { apiClient, ApiError } from "@/utils/api";
import { checkChecklistPermission } from "@/utils/permissions";
import {
  createImageFormDataPart,
  getImageValidationError,
  MAX_CHECKLIST_IMAGES,
  MAX_CHECKLIST_UPLOAD_BYTES,
  prepareUploadImage,
} from "@/features/media/prepare-image";
import {
  clearSubmissionId,
  createSubmissionStorageKey,
  getOrCreateSubmissionId,
} from "@/features/submissions/submission-id";
import {
  clearChecklistDraft,
  deleteChecklistDraftImage,
  loadChecklistDraft,
  persistChecklistDraftImage,
  saveChecklistDraft,
} from "@/features/checklist/checklist-draft";

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

const REQUIRED_CHECKLIST_FIELDS = [
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
] as const;

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
  const queryClient = useQueryClient();

  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const user = useAuthStore((state) => state.user);

  const isDriver = user?.role === "BUSINESS_USER" && !!user?.driverId;
  const submissionBusinessId = user?.businessId || "";
  const submissionStorageKey = useMemo(
    () =>
      createSubmissionStorageKey(
        "checklist",
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

  const [showImagePickerModal, setShowImagePickerModal] =
    useState<boolean>(false);
  const [currentPhotoField, setCurrentPhotoField] = useState<string>("");

  const [checklistImages, setChecklistImages] = useState<ChecklistImages>({});
  const checklistImagesRef = useRef<ChecklistImages>({});
  const stepDataRef = useRef<Partial<StepData>>({});

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
      const totalUploadBytes = Object.values(checklistImages).reduce(
        (total, images) =>
          total +
          images.reduce((fieldTotal, image) => fieldTotal + (image.fileSize || 0), 0),
        0,
      );

      if (totalUploadBytes > MAX_CHECKLIST_UPLOAD_BYTES) {
        Toast.show({
          type: "error",
          text1: "Fotos acima do limite",
          text2: "O tamanho total das fotos deve ser de no máximo 5 MB.",
          position: "top",
        });
        return;
      }

      const formData = new FormData();

      Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          formData.append(key, String(value));
        }
      });

      Object.entries(checklistImages).forEach(([fieldName, images]) => {
        images.forEach((image, index) => {
          const imageFile = createImageFormDataPart(
            image,
            `${fieldName}_${Date.now()}_${index}`,
          );

          formData.append(fieldName, imageFile);
        });
      });

      setIsSubmitting(true);
      submissionAbortControllerRef.current?.abort();
      const submissionController = new AbortController();
      submissionAbortControllerRef.current = submissionController;

      try {
        const submissionId =
          await getOrCreateSubmissionId(submissionStorageKey);
        formData.append("client_submission_id", submissionId);

        await apiClient.postFormData(
          `/vehicle-checklist/create-vehicle-checklist/${submissionBusinessId}`,
          formData,
          {
            signal: submissionController.signal,
            headers: { "Idempotency-Key": submissionId },
          },
        );

        void Haptics.impactAsync(
          Haptics.ImpactFeedbackStyle.Light,
        ).catch(() => undefined);
        draftPersistenceEnabledRef.current = false;
        if (draftSaveTimerRef.current) {
          clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
        setHasDraft(false);
        void Promise.all([
          clearChecklistDraft(submissionStorageKey, submissionId),
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
          text1: "Checklist criado!",
          text2: "O checklist veicular foi registrado com sucesso.",
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
          text1: "Erro ao criar checklist",
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
      checklistImages,
      submissionBusinessId,
      submissionStorageKey,
      router,
      queryClient,
      vehicleId,
    ],
  );

  const dynamicSchema = createDynamicChecklistSchema();

  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    getValues,
    reset,
    subscribe,
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

  const persistChecklistDraft = useCallback(
    async (formData: Partial<CreateChecklistFormData>) => {
      if (!isDraftReady || !draftPersistenceEnabledRef.current) return;
      if (!user?.id || !submissionBusinessId || !vehicleId) return;

      const submissionId =
        await getOrCreateSubmissionId(submissionStorageKey);
      await saveChecklistDraft<CreateChecklistFormData, StepData>(
        submissionStorageKey,
        {
          submissionId,
          formData,
          stepData: stepDataRef.current,
          images: checklistImagesRef.current,
          updatedAt: new Date().toISOString(),
        },
      );
    },
    [
      isDraftReady,
      submissionBusinessId,
      submissionStorageKey,
      user?.id,
      vehicleId,
    ],
  );

  const scheduleChecklistDraftSave = useCallback(
    (formData: Partial<CreateChecklistFormData>) => {
      if (!isDraftReady || !draftPersistenceEnabledRef.current) return;
      if (!user?.id || !submissionBusinessId || !vehicleId) return;

      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
      setHasDraft(true);
      draftSaveTimerRef.current = setTimeout(() => {
        draftSaveTimerRef.current = null;
        void persistChecklistDraft(formData).catch(() => undefined);
      }, 500);
    },
    [
      isDraftReady,
      persistChecklistDraft,
      submissionBusinessId,
      user?.id,
      vehicleId,
    ],
  );

  useEffect(() => {
    stepDataRef.current = stepData;
  }, [stepData]);

  useEffect(() => {
    checklistImagesRef.current = checklistImages;
  }, [checklistImages]);

  useEffect(() => {
    let isCancelled = false;
    setIsDraftReady(false);
    draftPersistenceEnabledRef.current = true;

    void (async () => {
      if (!user?.id || !submissionBusinessId || !vehicleId) return;
      const draft = await loadChecklistDraft<
        CreateChecklistFormData,
        StepData
      >(submissionStorageKey);
      if (!draft || isCancelled) return;

      const restoredValues = {
        ...getValues(),
        ...draft.formData,
        vehicleId,
        businessId: submissionBusinessId,
      } as CreateChecklistFormData;
      reset(restoredValues);
      setStepData(draft.stepData);
      setChecklistImages(draft.images);
      setHasDraft(true);

      if (isDriver || draft.stepData.driverId) {
        setCurrentStep("form");
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
        callback: ({ values }) => scheduleChecklistDraftSave(values),
      }),
    [scheduleChecklistDraftSave, subscribe],
  );

  useEffect(() => {
    const flushPendingDraft = () => {
      if (!draftSaveTimerRef.current) return;
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
      void persistChecklistDraft(getValues()).catch(() => undefined);
    };

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") flushPendingDraft();
    });

    return () => {
      subscription.remove();
      flushPendingDraft();
    };
  }, [getValues, persistChecklistDraft]);

  useEffect(() => {
    const hasSelectedContext =
      !isDriver && Boolean(stepData.branchId || stepData.driverId);
    const hasImages = Object.values(checklistImages).some(
      (images) => images.length > 0,
    );
    if (!hasDraft && !hasSelectedContext && !hasImages) return;
    scheduleChecklistDraftSave(getValues());
  }, [
    checklistImages,
    getValues,
    hasDraft,
    isDriver,
    scheduleChecklistDraftSave,
    stepData,
  ]);

  const discardChecklistDraft = useCallback(async () => {
    draftPersistenceEnabledRef.current = false;
    submissionAbortControllerRef.current?.abort();
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }

    const submissionId =
      await getOrCreateSubmissionId(submissionStorageKey);
    Object.values(checklistImagesRef.current).forEach((images) =>
      images.forEach(deleteChecklistDraftImage),
    );
    await Promise.all([
      clearChecklistDraft(submissionStorageKey, submissionId),
      clearSubmissionId(submissionStorageKey),
    ]);

    reset();
    setChecklistImages({});
    checklistImagesRef.current = {};
    setHasDraft(false);

    if (isDriver) {
      const driverStepData = {
        driverId: user?.driverId || "",
        driverName: user?.name || "",
        driverCnh: "",
        branchId: vehicleData?.branchId || "",
        branchName: vehicleData?.branchName || "",
      };
      setStepData(driverStepData);
      stepDataRef.current = driverStepData;
      setValue("driverId", driverStepData.driverId);
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
      await discardChecklistDraft();
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
  }, [discardChecklistDraft]);

  const requiredValues = useWatch({
    control,
    name: REQUIRED_CHECKLIST_FIELDS,
    exact: true,
  });

  const areAllRequiredFieldsFilled = useMemo(() => {
    const formData = Object.fromEntries(
      REQUIRED_CHECKLIST_FIELDS.map((fieldName, index) => [
        fieldName,
        requiredValues[index],
      ]),
    ) as Partial<CreateChecklistFormData>;

    if (isDriver) {
      if (!stepData.driverId) return false;
    } else {
      if (!stepData.branchId || !stepData.driverId) return false;
    }

    for (const field of REQUIRED_CHECKLIST_FIELDS) {
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
    requiredValues,
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
    submissionAbortControllerRef.current?.abort();

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

  const appendSelectedImage = useCallback(
    async (selectedAsset: ImagePicker.ImagePickerAsset) => {
      const currentImageCount = Object.values(checklistImages).reduce(
        (total, images) => total + images.length,
        0,
      );

      if (currentImageCount >= MAX_CHECKLIST_IMAGES) {
        Toast.show({
          type: "error",
          text1: "Limite de fotos atingido",
          text2: `O checklist aceita no máximo ${MAX_CHECKLIST_IMAGES} fotos.`,
          position: "top",
        });
        return;
      }

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

        const currentUploadBytes = Object.values(checklistImages).reduce(
          (total, images) =>
            total +
            images.reduce(
              (fieldTotal, image) => fieldTotal + (image.fileSize || 0),
              0,
            ),
          0,
        );

        if (
          currentUploadBytes + (asset.fileSize || 0) >
          MAX_CHECKLIST_UPLOAD_BYTES
        ) {
          const remainingMegabytes = Math.max(
            0,
            (MAX_CHECKLIST_UPLOAD_BYTES - currentUploadBytes) /
              (1024 * 1024),
          ).toFixed(1);
          Toast.show({
            type: "error",
            text1: "Limite total de fotos",
            text2: `As fotos podem somar no máximo 5 MB. Restam ${remainingMegabytes} MB.`,
            position: "top",
            visibilityTime: 4000,
          });
          return;
        }

        const submissionId =
          await getOrCreateSubmissionId(submissionStorageKey);
        asset = persistChecklistDraftImage(
          asset,
          submissionId,
          currentPhotoField,
        );
        persistedAsset = asset;
        const nextImages = {
          ...checklistImages,
          [currentPhotoField]: [
            ...(checklistImages[currentPhotoField] || []),
            asset,
          ],
        };
        await saveChecklistDraft<CreateChecklistFormData, StepData>(
          submissionStorageKey,
          {
            submissionId,
            formData: getValues(),
            stepData: stepDataRef.current,
            images: nextImages,
            updatedAt: new Date().toISOString(),
          },
        );
        checklistImagesRef.current = nextImages;
        setChecklistImages(nextImages);
        setHasDraft(true);
      } catch (error) {
        if (persistedAsset) deleteChecklistDraftImage(persistedAsset);
        if (error instanceof Error && error.name === "AbortError") return;
        Toast.show({
          type: "error",
          text1: "Não foi possível preparar a foto",
          text2: "Tente novamente ou selecione outra imagem.",
          position: "top",
        });
      }
    },
    [checklistImages, currentPhotoField, getValues, submissionStorageKey],
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

    if (!result.canceled && result.assets[0] && currentPhotoField) {
      await appendSelectedImage(result.assets[0]);
    }
  }, [appendSelectedImage, currentPhotoField]);

  const pickFromGallery = useCallback(async () => {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

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

    if (!result.canceled && result.assets[0] && currentPhotoField) {
      await appendSelectedImage(result.assets[0]);
    }
  }, [appendSelectedImage, currentPhotoField]);

  const showImagePicker = useCallback((fieldName: string) => {
    setCurrentPhotoField(fieldName);
    setShowImagePickerModal(true);
  }, []);

  const getPhotoTitle = (fieldName: string): string => {
    return PHOTO_TITLE_MAP[fieldName] || "Foto do Checklist";
  };

  const removeImage = useCallback((fieldName: string, imageIndex: number) => {
    setChecklistImages((previousImages) => {
      const fieldImages = previousImages[fieldName] || [];
      const removedImage = fieldImages[imageIndex];
      if (removedImage) deleteChecklistDraftImage(removedImage);

      return {
        ...previousImages,
        [fieldName]: fieldImages.filter((_, index) => index !== imageIndex),
      };
    });
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
    isDraftReady,
    hasDraft,
    showDiscardDraftModal,
    isDiscardingDraft,
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
    requestDiscardDraft,
    cancelDiscardDraft,
    confirmDiscardDraft,
  };
};
