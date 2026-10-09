import { useState, useCallback, useEffect, useMemo, useRef } from "react";

import * as ImagePicker from "expo-image-picker";

import { useRouter, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useForm, type SubmitHandler } from "react-hook-form";

import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "@/store";
import { useVehicleData } from "@/hooks";

import { createFuelSchema, CreateFuelFormData } from "@/schemas";

import { ApiError } from "@/utils/api";
import { checkFuelPermission } from "@/utils/permissions";

import {
  FUEL_FORM_FIELDS,
  calculateTotalAmount,
  fuelAttachmentIssues,
} from "@/features/fuel/fuel-rules";
import { buildFuelDefaults } from "@/features/fuel/fuel-defaults";

import {
  LIVE_VALIDATION_FORM_OPTIONS,
  canSubmitForm,
  firstInvalidField,
  messagesOf,
} from "@/features/forms/live-validation";
import { resolverWithVehicleMileage } from "@/features/forms/mileage-resolver";
import { useLiveFields } from "@/features/forms/use-live-fields";
import { useFieldFocus } from "@/features/forms/use-field-focus";

import { useImageCapture } from "@/features/media/use-image-capture";
import { useWizardSteps } from "@/features/submissions/use-wizard-steps";
import { useDiscardConfirmation } from "@/features/submissions/use-discard-confirmation";

import { submitOrQueue } from "@/features/submissions/submit-or-queue";
import { queuedNotice } from "@/features/submissions/queue-decision";
import {
  clearSubmissionId,
  createSubmissionStorageKey,
  getOrCreateSubmissionId,
} from "@/features/submissions/submission-id";

import { useDraftAutosave } from "@/features/submissions/use-draft-autosave";
import { createDraftChangeGate } from "@/features/submissions/draft-change-gate";
import {
  clearFuelDraft,
  deleteFuelDraftImage,
  loadFuelDraft,
  persistFuelDraftImage,
  saveFuelDraft,
  type FuelDraft,
} from "@/features/fuel/fuel-draft";
import { useOdometerPrecheck } from "@/features/ai-precheck/use-photo-precheck";
import type { StoredPrecheck } from "@/features/ai-precheck/device-precheck";

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

  // The phone's pre-check of the odometer photo (decision 14.2), kept for the
  // draft the same way the photo is.
  const precheckRef = useRef<StoredPrecheck | null>(null);

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

  // The defaults of the form as it opened: their date is the moment the km
  // rule knows the reading is the newest (decision 16.703).
  const initialDefaultsRef = useRef<ReturnType<typeof buildFuelDefaults> | null>(null);
  if (!initialDefaultsRef.current) {
    initialDefaultsRef.current = buildFuelDefaults({
      vehicleId: vehicleId || "",
      businessId: submissionBusinessId,
    });
  }
  const initialDefaults = initialDefaultsRef.current;

  const vehicleMileage = vehicleData?.current_mileage;

  // The schema plus what only the loaded vehicle knows, checked live.
  const resolver = useMemo(
    () =>
      resolverWithVehicleMileage<CreateFuelFormData>(createFuelSchema, {
        mileageField: "current_mileage",
        dateField: "refueling_date",
        defaultDate: initialDefaults.refueling_date,
        vehicleMileage,
      }),
    [initialDefaults.refueling_date, vehicleMileage],
  );

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

  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    getValues,
    getFieldState,
    reset,
    subscribe,
    watch,
    trigger,
  } = useForm<CreateFuelFormData>({
    resolver,
    ...LIVE_VALIDATION_FORM_OPTIONS,
    defaultValues: initialDefaults,
  });

  const fieldFocus = useFieldFocus();

  // The vehicle's km may arrive after the driver typed theirs: the rule
  // re-checks a km already visited instead of waiting for the next keystroke.
  useEffect(() => {
    const mileage = getFieldState("current_mileage");
    if (mileage.isTouched || mileage.invalid) void trigger("current_mileage");
  }, [vehicleMileage, getFieldState, trigger]);

  const odometerPrecheck = useOdometerPrecheck(
    odometerImage?.uri,
    watch("current_mileage"),
  );

  const markDraftPresent = useCallback(() => setHasDraft(true), []);

  const [draftChangeGate] = useState(createDraftChangeGate);

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
      precheck: precheckRef.current ?? undefined,
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

        // The pre-check of THIS photo and km, if it ran: a hint for the
        // office, never a condition of the send (decision 14.2).
        const devicePrecheck = odometerPrecheck.payloadFor(
          odometerImage.uri,
          data.current_mileage,
        );
        if (devicePrecheck) body.device_precheck = devicePrecheck;

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
                // After a forced logout it waits for this driver, not for a
                // connection (MOB-07).
                text2: queuedNotice(outcome),
                position: "top",
                visibilityTime: outcome === "queued" ? 4000 : 6000,
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
      odometerPrecheck,
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

  // A finished pre-check is saved with the draft, like the photo it read.
  useEffect(() => {
    precheckRef.current = odometerPrecheck.stored;
    if (odometerPrecheck.stored) draft.schedule();
  }, [draft, odometerPrecheck.stored]);

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
      odometerPrecheck.restore(storedDraft.precheck);
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
        formState: { values: true, isDirty: true },
        // Only the driver's edits make a draft: the screen's own fills
        // (vehicle defaults, GPS) leave the form clean (draft-change-gate).
        callback: (state) => {
          if (draftChangeGate.accepts(state)) draft.schedule();
        },
      }),
    [draft, draftChangeGate, subscribe],
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

  // The photo is a file, not a form value: its message lives here, shown on
  // a submit or once the driver removed it, gone as soon as one is attached.
  const attachmentIssues = useMemo(
    () => fuelAttachmentIssues({ hasOdometerPhoto: Boolean(odometerImage) }),
    [odometerImage],
  );
  const attachments = useLiveFields({ issues: attachmentIssues, order: FUEL_FORM_FIELDS });

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
    draftChangeGate.reset();
    // A fresh form: the photo area goes back to neutral like the text fields.
    attachments.reset();
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
    attachments.reset,
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

  // Validated as it lands: a "localização é obrigatória" shown after a tap
  // goes away when the GPS answers, and comes back if the position is lost.
  useEffect(() => {
    const shouldValidate = getFieldState("latitude").invalid;

    setValue("latitude", locationData?.latitude as number, { shouldValidate });
    setValue("longitude", locationData?.longitude as number, { shouldValidate });
  }, [locationData, setValue, getFieldState]);

  /**
   * The tap on "Abastecer" (decision 16.700): everything is checked, nothing
   * leaves while anything is invalid, and the first invalid field is brought
   * into view — focused when it is a text field.
   */
  const submitForm = useCallback(() => {
    const missingAttachment = attachments.attempt();

    const refuse = (field: string | null, message?: string) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => undefined,
      );

      if (field && (FUEL_FORM_FIELDS as readonly string[]).includes(field)) {
        fieldFocus.focusField(field, message);
        return;
      }

      // A field with no place on this screen (a selection made in an earlier
      // step) still says what is wrong.
      Toast.show({
        type: "error",
        text1: "Revise o abastecimento",
        text2: message ?? "Há dados inválidos no abastecimento.",
        position: "top",
      });
    };

    return handleSubmit(
      (data) => {
        if (missingAttachment) {
          return refuse(missingAttachment, attachmentIssues.odometer_photo ?? undefined);
        }
        return onSubmit(data);
      },
      (invalid) => {
        const issues: Record<string, string> = {
          ...messagesOf(invalid),
          ...(missingAttachment ? { [missingAttachment]: attachmentIssues.odometer_photo ?? "" } : {}),
        };
        const first = firstInvalidField(FUEL_FORM_FIELDS, issues);
        refuse(first, first ? issues[first] : undefined);
      },
    )();
  }, [attachments, attachmentIssues, fieldFocus, handleSubmit, onSubmit]);

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

  const touchAttachment = attachments.touch;

  const removeOdometerImage = useCallback(() => {
    deleteFuelDraftImage(odometerImageRef.current);
    odometerImageRef.current = null;
    setOdometerImage(null);

    // Taking the photo away is leaving the field empty.
    touchAttachment("odometer_photo");
  }, [touchAttachment]);

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
    odometerPrecheckWarning: odometerPrecheck.warning,
    dismissOdometerPrecheck: odometerPrecheck.dismiss,
    isDraftReady,
    hasDraft,
    showDiscardDraftModal: discardConfirmation.isVisible,
    isDiscardingDraft: discardConfirmation.isDiscarding,
    isLocationLoading,
    vehicleData,
    isLoadingVehicle,
    control,
    errors,
    odometerPhotoError: attachments.errorOf("odometer_photo"),
    fieldFocus,
    setValue,
    trigger,
    permissions,
    stepInfo: getStepInfo(),
    submitForm,
    canSubmit: canSubmitForm({ isBusy: isSubmitting || isLocationLoading }),
    goToNextStep,
    goToPrevStep,
    canProceedToNext,
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
