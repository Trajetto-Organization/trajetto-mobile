import { useState, useCallback, useEffect, useMemo, useRef } from "react";

import * as ImagePicker from "expo-image-picker";

import { useRouter, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useForm, useWatch, type SubmitHandler } from "react-hook-form";

import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { useAuthStore } from "@/store";
import { useVehicleData } from "@/hooks";

import { createChecklistSchema, CreateChecklistFormData } from "@/schemas";

import { ApiError } from "@/utils/api";
import { checkChecklistPermission } from "@/utils/permissions";

import {
  MAX_CHECKLIST_IMAGES,
  MAX_CHECKLIST_UPLOAD_BYTES,
} from "@/features/media/prepare-image";

import { useImageCapture } from "@/features/media/use-image-capture";
import { useWizardSteps } from "@/features/submissions/use-wizard-steps";
import { useDiscardConfirmation } from "@/features/submissions/use-discard-confirmation";

import { submitOrQueue } from "@/features/submissions/submit-or-queue";
import { queuedNotice } from "@/features/submissions/queue-decision";
import {
  CHECKLIST_FORM_FIELDS,
  checklistPhotoIssues,
  getPhotoTitle as getChecklistPhotoTitle,
  photoFieldKey,
  REQUIRED_CHECKLIST_FIELDS,
} from "@/features/checklist/checklist-rules";
import { buildChecklistDefaults } from "@/features/checklist/checklist-defaults";

import {
  LIVE_VALIDATION_FORM_OPTIONS,
  canSubmitForm,
  firstInvalidField,
  messagesOf,
} from "@/features/forms/live-validation";
import { resolverWithVehicleMileage } from "@/features/forms/mileage-resolver";
import { useLiveFields } from "@/features/forms/use-live-fields";
import { useFieldFocus } from "@/features/forms/use-field-focus";
import {
  clearSubmissionId,
  createSubmissionStorageKey,
  getOrCreateSubmissionId,
} from "@/features/submissions/submission-id";

import { useDraftAutosave } from "@/features/submissions/use-draft-autosave";
import { createDraftChangeGate } from "@/features/submissions/draft-change-gate";
import {
  clearChecklistDraft,
  deleteChecklistDraftImage,
  loadChecklistDraft,
  persistChecklistDraftImage,
  saveChecklistDraft,
  type ChecklistDraft,
} from "@/features/checklist/checklist-draft";
import { useOdometerPrecheck } from "@/features/ai-precheck/use-photo-precheck";
import type { StoredPrecheck } from "@/features/ai-precheck/device-precheck";

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

/** In order; a driver skips straight to the form. */
const CHECKLIST_STEPS = ["branch", "driver", "form"] as const;

type Step = (typeof CHECKLIST_STEPS)[number];

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

  const [stepData, setStepData] = useState<Partial<StepData>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Photos now travel on their own leg of the submission, which takes real
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
    steps: CHECKLIST_STEPS,
    isCollapsed: isDriver,
    canLeaveStep,
    onExit: router.back,

    // Leaving a step abandons whatever the submission was doing.
    onNavigate: () => submissionAbortControllerRef.current?.abort(),
  });

  const [showImagePickerModal, setShowImagePickerModal] =
    useState<boolean>(false);
  const [currentPhotoField, setCurrentPhotoField] = useState<string>("");

  const [checklistImages, setChecklistImages] = useState<ChecklistImages>({});
  const checklistImagesRef = useRef<ChecklistImages>({});
  const stepDataRef = useRef<Partial<StepData>>({});

  // The phone's pre-check of the km photo (decision 14.2), kept for the draft.
  const precheckRef = useRef<StoredPrecheck | null>(null);

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
  const initialDefaultsRef = useRef<ReturnType<typeof buildChecklistDefaults> | null>(null);
  if (!initialDefaultsRef.current) {
    initialDefaultsRef.current = buildChecklistDefaults({
      vehicleId: vehicleId || "",
      businessId: submissionBusinessId,
    });
  }
  const initialDefaults = initialDefaultsRef.current;

  const vehicleMileage = vehicleData?.current_mileage;

  // The schema plus what only the loaded vehicle knows, checked live.
  const resolver = useMemo(
    () =>
      resolverWithVehicleMileage<CreateChecklistFormData>(createChecklistSchema, {
        mileageField: "current_mileage",
        dateField: "checklist_date",
        defaultDate: initialDefaults.checklist_date,
        vehicleMileage,
      }),
    [initialDefaults.checklist_date, vehicleMileage],
  );

  const {
    control,
    handleSubmit,
    formState: { errors },
    setValue,
    getValues,
    getFieldState,
    reset,
    subscribe,
    trigger,
  } = useForm<CreateChecklistFormData>({
    resolver,
    ...LIVE_VALIDATION_FORM_OPTIONS,
    defaultValues: initialDefaults,
  });

  const fieldFocus = useFieldFocus();

  // The vehicle's km may arrive after the driver typed theirs: a km already
  // visited is re-checked instead of waiting for the next keystroke.
  useEffect(() => {
    const mileage = getFieldState("current_mileage");
    if (mileage.isTouched || mileage.invalid) void trigger("current_mileage");
  }, [vehicleMileage, getFieldState, trigger]);

  // The km photo the pre-check reads: the latest one of the field.
  const mileagePhotoUri = checklistImages.current_mileage?.at(-1)?.uri ?? null;

  const mileagePrecheck = useOdometerPrecheck(
    mileagePhotoUri,
    useWatch({ control, name: "current_mileage" }),
  );

  const markDraftPresent = useCallback(() => setHasDraft(true), []);

  const [draftChangeGate] = useState(createDraftChangeGate);

  const draft = useDraftAutosave<ChecklistDraft<CreateChecklistFormData, StepData>>({
    storageKey: submissionStorageKey,
    isEnabled:
      isDraftReady &&
      Boolean(user?.id && submissionBusinessId && vehicleId),
    save: saveChecklistDraft,
    onSchedule: markDraftPresent,
    buildDraft: (submissionId) => ({
      submissionId,
      formData: getValues(),
      stepData: stepDataRef.current,
      images: checklistImagesRef.current,
      precheck: precheckRef.current ?? undefined,
      updatedAt: new Date().toISOString(),
    }),
  });

  const onSubmit: SubmitHandler<CreateChecklistFormData> = useCallback(
    async (data: CreateChecklistFormData) => {
      const totalUploadBytes = Object.values(checklistImages).reduce(
        (total, images) =>
          total +
          images.reduce(
            (fieldTotal, image) => fieldTotal + (image.fileSize || 0),
            0,
          ),
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

      const body: Record<string, unknown> = {};

      Object.entries(data).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          body[key] = value;
        }
      });

      // Stamp the origin: the web omits the field and takes the DB default
      // (WEB_DASHBOARD), so this is what tells the record apart in reports.
      body.created_from = "MOBILE_APP";

      // The pre-check of THIS km photo and km, if it ran: a hint for the
      // office, never a condition of the send (decision 14.2).
      const devicePrecheck = mileagePrecheck.payloadFor(
        mileagePhotoUri,
        data.current_mileage,
      );
      if (devicePrecheck) body.device_precheck = devicePrecheck;

      const entries = Object.entries(checklistImages).flatMap(
        ([fieldName, images]) =>
          images.map((asset) => ({ file: asset, fieldName })),
      );

      setIsSubmitting(true);
      submissionAbortControllerRef.current?.abort();
      const submissionController = new AbortController();
      submissionAbortControllerRef.current = submissionController;

      const endpoint = `/vehicle-checklist/create-vehicle-checklist/${submissionBusinessId}`;
      let submissionId: string | null = null;

      // Stops the autosave from writing the form back to disk once it has been
      // handed off — to the API or to the queue. Either way this checklist is
      // finished work and the form should stop owning it.
      const releaseDraft = () => {
        draft.release();
        setHasDraft(false);
      };

      try {
        submissionId = await getOrCreateSubmissionId(submissionStorageKey);
        body.client_submission_id = submissionId;

        // Progress stays at full through the request that follows the uploads,
        // so the bar reads "saving" instead of vanishing at the moment the
        // driver is watching it finish. The `finally` clears it on every path.
        setUploadProgress({ uploaded: 0, total: entries.length });

        const outcome = await submitOrQueue({
          submissionId,
          kind: "checklist",
          endpoint,
          body,
          businessId: submissionBusinessId,
          vehicleId: vehicleId || "",
          vehicleLabel: vehicleData?.license_plate,
          entries,
          uploadType: "checklistPhotos",
          photoField: "photos",
          signal: submissionController.signal,
          onProgress: (uploaded, total) =>
            setUploadProgress({ uploaded, total }),
        });

        // Either way the checklist has left the form: it is on the server, or
        // it is in the queue with its own copy of the photos.
        releaseDraft();
        void Promise.all([
          clearChecklistDraft(submissionStorageKey, submissionId),
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
                text1: "Checklist criado!",
                text2: "O checklist veicular foi registrado com sucesso.",
                position: "top",
                visibilityTime: 3000,
              }
            : {
                type: "info",
                text1: "Checklist salvo no aparelho",
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
          text1: "Erro ao criar checklist",
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
      checklistImages,
      draft,
      mileagePhotoUri,
      mileagePrecheck,
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
    checklistImagesRef.current = checklistImages;
  }, [checklistImages]);

  // A finished pre-check is saved with the draft, like the photo it read.
  useEffect(() => {
    precheckRef.current = mileagePrecheck.stored;
    if (mileagePrecheck.stored) draft.schedule();
  }, [draft, mileagePrecheck.stored]);

  // Restores a checklist left half-filled, and lands the driver back on the
  // step they had reached rather than at the beginning.
  useEffect(() => {
    let isCancelled = false;
    setIsDraftReady(false);
    draft.resume();

    void (async () => {
      if (!user?.id || !submissionBusinessId || !vehicleId) return;

      const storedDraft = await loadChecklistDraft<
        CreateChecklistFormData,
        StepData
      >(submissionStorageKey);

      if (!storedDraft || isCancelled) return;

      reset({
        ...getValues(),
        ...storedDraft.formData,
        vehicleId,
        businessId: submissionBusinessId,
      } as CreateChecklistFormData);

      setStepData(storedDraft.stepData);
      setChecklistImages(storedDraft.images);
      mileagePrecheck.restore(storedDraft.precheck);
      setHasDraft(true);

      if (isDriver || storedDraft.stepData.driverId) {
        setCurrentStep("form");
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

  // Photos and the branch/driver choice live outside the form, so changing them
  // has to trigger a save the form subscription would never see.
  useEffect(() => {
    const hasSelectedContext =
      !isDriver && Boolean(stepData.branchId || stepData.driverId);
    const hasImages = Object.values(checklistImages).some(
      (images) => images.length > 0,
    );

    if (!hasDraft && !hasSelectedContext && !hasImages) return;
    draft.schedule();
  }, [checklistImages, draft, hasDraft, isDriver, stepData]);

  const requiredValues = useWatch({
    control,
    name: REQUIRED_CHECKLIST_FIELDS,
    exact: true,
  });

  // Photos are files, not form values: their messages live here, shown on a
  // submit or once the driver removed the last one, gone as soon as one is
  // attached; a photo a "Não" asks for appears with the answer.
  const photoIssues = useMemo(
    () =>
      checklistPhotoIssues(
        Object.fromEntries(
          REQUIRED_CHECKLIST_FIELDS.map((fieldName, index) => [
            fieldName,
            requiredValues[index],
          ]),
        ) as Partial<CreateChecklistFormData>,
        checklistImages,
      ),
    [checklistImages, requiredValues],
  );
  const photoFields = useLiveFields({ issues: photoIssues, order: CHECKLIST_FORM_FIELDS });

  const discardChecklistDraft = useCallback(async () => {
    draft.release();
    submissionAbortControllerRef.current?.abort();

    const submissionId = await getOrCreateSubmissionId(submissionStorageKey);
    Object.values(checklistImagesRef.current).forEach((images) =>
      images.forEach(deleteChecklistDraftImage),
    );
    await Promise.all([
      clearChecklistDraft(submissionStorageKey, submissionId),
      clearSubmissionId(submissionStorageKey),
    ]);

    reset();
    draftChangeGate.reset();
    // A fresh checklist: the photo areas go back to neutral like the answers.
    photoFields.reset();
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

    draft.resume();
    void getOrCreateSubmissionId(submissionStorageKey).catch(() => undefined);
  }, [
    draft,
    photoFields.reset,
    setCurrentStep,
    isDriver,
    reset,
    setValue,
    submissionStorageKey,
    user?.driverId,
    user?.name,
    vehicleData?.branchId,
    vehicleData?.branchName,
  ]);

  const discardConfirmation = useDiscardConfirmation({
    onDiscard: discardChecklistDraft,
  });

  /**
   * The tap on "Criar checklist" (decision 16.700): every answer and photo is
   * checked, nothing leaves while anything is missing, and the first invalid
   * field is brought into view — focused when it is a text field.
   */
  const submitForm = useCallback(() => {
    const missingPhoto = photoFields.attempt();

    const refuse = (field: string | null, message?: string) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => undefined,
      );

      if (field && CHECKLIST_FORM_FIELDS.includes(field)) {
        fieldFocus.focusField(field, message);
        return;
      }

      // A field with no place on this screen (a selection made in an earlier
      // step) still says what is wrong.
      Toast.show({
        type: "error",
        text1: "Revise o checklist",
        text2: message ?? "Há dados inválidos no checklist.",
        position: "top",
      });
    };

    return handleSubmit(
      (data) => {
        if (missingPhoto) return refuse(missingPhoto, photoIssues[missingPhoto] ?? undefined);
        return onSubmit(data);
      },
      (invalid) => {
        const issues: Record<string, string> = {
          ...messagesOf(invalid),
          ...(missingPhoto ? { [missingPhoto]: photoIssues[missingPhoto] ?? "" } : {}),
        };
        const first = firstInvalidField(CHECKLIST_FORM_FIELDS, issues);
        refuse(first, first ? issues[first] : undefined);
      },
    )();
  }, [fieldFocus, handleSubmit, onSubmit, photoFields, photoIssues]);

  /**
   * Files the captured photo under the question it answers.
   *
   * The image arrives already transcoded and within the per-file limit; what is
   * left is the two checklist-specific budgets — how many photos an inspection
   * may carry, and how many bytes in total — plus moving it somewhere the OS
   * will not evict.
   */
  const appendSelectedImage = useCallback(
    async (asset: ImagePicker.ImagePickerAsset) => {
      const images = Object.values(checklistImages);

      const currentImageCount = images.reduce(
        (total, fieldImages) => total + fieldImages.length,
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

      const currentUploadBytes = images.reduce(
        (total, fieldImages) =>
          total +
          fieldImages.reduce(
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
          (MAX_CHECKLIST_UPLOAD_BYTES - currentUploadBytes) / (1024 * 1024),
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

      let persistedAsset: ImagePicker.ImagePickerAsset | null = null;

      try {
        const submissionId =
          await getOrCreateSubmissionId(submissionStorageKey);

        persistedAsset = persistChecklistDraftImage(
          asset,
          submissionId,
          currentPhotoField,
        );

        const nextImages = {
          ...checklistImages,
          [currentPhotoField]: [
            ...(checklistImages[currentPhotoField] || []),
            persistedAsset,
          ],
        };

        // Written straight away rather than through the debounce: a photo is
        // expensive to retake, and the app may not get another chance.
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

  const { takePhoto, pickFromGallery } = useImageCapture({
    onCapture: appendSelectedImage,
  });

  const showImagePicker = useCallback((fieldName: string) => {
    setCurrentPhotoField(fieldName);
    setShowImagePickerModal(true);
  }, []);

  const getPhotoTitle = getChecklistPhotoTitle;

  const touchPhoto = photoFields.touch;

  const removeImage = useCallback((fieldName: string, imageIndex: number) => {
    // Taking a photo away is visiting the area: if it was the last one of a
    // required area, its message shows now.
    touchPhoto(photoFieldKey(fieldName));

    setChecklistImages((previousImages) => {
      const fieldImages = previousImages[fieldName] || [];
      const removedImage = fieldImages[imageIndex];
      if (removedImage) deleteChecklistDraftImage(removedImage);

      return {
        ...previousImages,
        [fieldName]: fieldImages.filter((_, index) => index !== imageIndex),
      };
    });
  }, [touchPhoto]);

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
    uploadProgress,
    isDraftReady,
    hasDraft,
    showDiscardDraftModal: discardConfirmation.isVisible,
    isDiscardingDraft: discardConfirmation.isDiscarding,
    showImagePickerModal,
    setShowImagePickerModal,
    currentPhotoField,
    checklistImages,
    mileagePrecheckWarning: mileagePrecheck.warning,
    dismissMileagePrecheck: mileagePrecheck.dismiss,
    vehicleData,
    isLoadingVehicle,
    control,
    errors,
    photoErrors: photoFields.visible,
    fieldFocus,
    setValue,
    trigger,
    permissions,
    stepInfo: getStepInfo(),
    submitForm,
    canSubmit: canSubmitForm({ isBusy: isSubmitting }),
    goToNextStep,
    goToPrevStep,
    canProceedToNext,
    takePhoto,
    pickFromGallery,
    showImagePicker,
    getPhotoTitle,
    removeImage,
    requestDiscardDraft: discardConfirmation.request,
    cancelDiscardDraft: discardConfirmation.cancel,
    confirmDiscardDraft: discardConfirmation.confirm,
  };
};
