import { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { KeyboardAvoidingView } from "../../components/ui/keyboard-avoiding-view";

import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import Ionicons from "@expo/vector-icons/Ionicons";
import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";

import { Directory, File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";

import { ProtectedRoute } from "../../components/protected-route";
import { StatusBanners } from "../../components/status-banners";

import { Button, Input, UploadProgressBar } from "../../components/ui";
import { SignaturePad } from "../../components/screens/deliveries";
import { OccurrenceFormFields } from "../../components/screens/occurrences/occurrence-form-fields";
import { FieldAnchor } from "../../components/forms/field-anchor";

import { useAuthStore } from "@/store/auth-store";
import { useOutboxStore } from "@/store/outbox-store";
import { useThemeColors } from "@/hooks/use-theme";

import { useImageCapture } from "@/features/media/use-image-capture";
import type { PendingCaptureMarker } from "@/features/media/pending-capture";
import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";

import { useDeliveryActions } from "@/features/deliveries/hooks/use-delivery-actions";
import { useDeliveryDraft } from "@/features/deliveries/hooks/use-delivery-draft";
import {
  deleteDeliveryDraftFile,
  loadProofDraft,
  persistDeliveryDraftFile,
  saveProofDraft,
} from "@/features/deliveries/delivery-draft";
import type {
  DeliveryCaptureTarget,
  ProofDraft,
} from "@/features/deliveries/delivery-draft-rules";

import {
  DELIVERED_KIND,
  DELIVERED_MAX_PHOTOS,
  DELIVERED_PENDING_LABEL,
  deliveredChoiceOf,
  deliveredMissing,
  deliveredRequestPending,
  deliveredSectionsOf,
} from "@/features/deliveries/delivered-requirements";
import {
  OccurrenceFormError,
  answerTouchesOnChange,
  checkOccurrenceForm,
  typeFormOf,
} from "@/features/occurrences/occurrence-form";
import {
  SCREEN_FIELDS,
  proofScreenIssues,
  proofScreenOrder,
} from "@/features/deliveries/delivery-form-issues";
import { useLiveFieldMessages, useLiveFieldState } from "@/features/forms/use-live-fields";
import { useFieldFocus } from "@/features/forms/use-field-focus";
import {
  draftAnswersOf,
  type DraftAnswer,
  type DraftAnswers,
} from "@/features/occurrences/draft-answers";
import {
  occurrenceReviewOf,
  reviewEntryOf,
  reviewFormState,
} from "@/features/occurrences/occurrence-queue-rules";
import { useFormRefresh } from "@/features/occurrences/use-form-refresh";
import {
  queuedDeliveredFiles,
  queuedDeliveredTexts,
} from "@/features/deliveries/delivered-review-rules";
import { reviseQueuedDelivered } from "@/features/deliveries/delivered-review";
import type { OutboxItem } from "@/features/submissions/outbox";

import { deliveryProofFormSchema } from "@/schemas/delivery";
import { normalizeSingleLineText } from "@/schemas/text-rules";

import type { UploadFile } from "@/features/media/upload-to-storage";

import { usePhotoPrecheck } from "@/features/ai-precheck/use-photo-precheck";
import {
  precheckApplies,
  precheckForSubmit,
  proofWarning,
} from "@/features/ai-precheck/device-precheck";
import { businessDayOf } from "@/features/ai-precheck/proof-precheck-rules";
import { PrecheckNotice } from "../../components/screens/ai-precheck/precheck-notice";

/**
 * Writes the drawn signature to a cache file so the outbox can own a copy
 * like any other photo — the queue copies files, never data URLs.
 */
const saveSignatureToFile = (dataUrl: string): UploadFile => {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

  const directory = new Directory(Paths.cache, "trajetto-signatures");
  directory.create({ intermediates: true, idempotent: true });

  const file = new File(directory, `${randomUUID()}.png`);
  file.write(bytes);

  return {
    uri: file.uri,
    fileName: file.name,
    fileSize: file.size ?? bytes.length,
    mimeType: "image/png",
  };
};

// The labels whose mark depends on the delivery type (decision 14.3).
const RECEIPT_LABEL = "Foto do canhoto";
const SIGNATURE_LABEL = "Assinatura na tela";

/** The first message the proof form would show for "Quem recebeu", if any. */
const receivedByErrorOf = (value: string): string | undefined => {
  const parsed = deliveryProofFormSchema.safeParse({
    receivedBy: normalizeSingleLineText(value),
  });

  return parsed.success ? undefined : parsed.error.issues[0]?.message;
};

/**
 * Proof of delivery as a routed screen — not an RN Modal — because the
 * toasts render through the app root's portal, and a native Modal sits above
 * that portal and hides them. The checklist and refuelling made the same
 * choice for the same reason.
 *
 * The stub photo comes from the camera only (decision 6.9), and everything
 * the driver collects here is kept on disk as it is collected (MOB-12).
 *
 * Decision 14.3: delivering is reporting a DELIVERED occurrence. The screen
 * renders the chosen type's requirements (receipt, signature, photos, form);
 * with more than one type it offers them at the top, the default first. A
 * day cached before the update has no types and keeps the legacy proof.
 *
 * With `review=<queued item id>` it reopens a queued proof the API refused
 * over its form or its type (design §8.3): the receipt, the signature and the
 * photos already in the queue stay; the driver answers the current form or
 * picks another delivery type, and it goes back under the same submission.
 */
const DeliveryProofScreen = () => {
  const router = useRouter();
  const colors = useThemeColors();
  const { id, review } = useLocalSearchParams<{ id: string; review?: string }>();

  const reviewId = typeof review === "string" && review.length > 0 ? review : null;

  const userId = useAuthStore((state) => state.user?.id ?? null);

  const {
    businessId,
    deliveries,
    deliveredTypes,
    journey,
    isLoading: isListLoading,
    refetch,
  } = useMyDeliveries();
  const actions = useDeliveryActions(businessId);

  // The reread of the day that brings the current form after a refusal.
  const { refresh: formRefresh, request: refreshForm } = useFormRefresh({
    refetch,
    listLoading: isListLoading,
  });

  // The queued proof under review, held from the moment it is found: once
  // revised it leaves the failed state, and the screen must not flip.
  const outboxItems = useOutboxStore((state) => state.items);
  const [reviewItem, setReviewItem] = useState<OutboxItem | null>(null);
  const [isRevising, setIsRevising] = useState<boolean>(false);

  const listed = useMemo(
    () =>
      reviewId
        ? (outboxItems.find(
            (item) => item.id === reviewId && item.kind === DELIVERED_KIND,
          ) ?? null)
        : null,
    [outboxItems, reviewId],
  );

  const choice = useMemo(() => deliveredChoiceOf(deliveredTypes), [deliveredTypes]);

  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [signature, setSignature] = useState<UploadFile | null>(null);
  const [photos, setPhotos] = useState<UploadFile[]>([]);

  const [receivedBy, setReceivedBy] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const [typeId, setTypeId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<DraftAnswers>({});
  // Errors show on the fields visited, and on all of them after a try
  // (decision 16.700).
  const liveState = useLiveFieldState();
  const { attempted, setAttempted } = liveState;
  const fieldFocus = useFieldFocus();

  const [isSignatureOpen, setIsSignatureOpen] = useState<boolean>(false);

  const delivery = useMemo(
    () => deliveries.find((entry) => entry.id === id) ?? null,
    [deliveries, id],
  );

  const prefilled = useRef(false);

  useEffect(() => {
    if (!listed || prefilled.current) return;

    prefilled.current = true;
    setReviewItem(listed);

    // Another company's, or nothing to review: the screen says so instead.
    if (reviewEntryOf(listed, businessId) !== "open") return;

    const texts = queuedDeliveredTexts(listed.body);

    setTypeId(texts.typeId);
    setReceivedBy(texts.receivedBy);
    setDescription(texts.description);
    setAnswers(draftAnswersOf(listed.body.form_answers));
    setAttempted(true);

    // The current forms and types, not the ones this phone cached.
    refreshForm();
  }, [listed, businessId, refreshForm]);

  const queuedReview = reviewItem ? occurrenceReviewOf(reviewItem) : null;

  // As first found: another company's proof, one with nothing to review, or
  // one no longer on the phone.
  const reviewEntry = reviewId ? reviewEntryOf(reviewItem ?? listed, businessId) : null;

  // Decision 14.2: the phone reads the receipt offline, when the company
  // bought the reading. Off, it neither runs nor shows anything.
  const receiptPrecheck = usePhotoPrecheck("proof");

  const draft = useDeliveryDraft<ProofDraft>({
    kind: "delivery-proof",
    userId,
    businessId,
    // A review lives in the queue item; a draft would be a second copy.
    deliveryId: reviewId ? null : (delivery?.id ?? null),
    load: loadProofDraft,
    save: saveProofDraft,
    build: (submissionId) => ({
      submissionId,
      photo,
      signature,
      receivedBy,
      typeId,
      photos,
      answers,
      description,
      precheck: receiptPrecheck.stored ?? undefined,
      updatedAt: new Date().toISOString(),
    }),
    restore: (stored) => {
      setPhoto(stored.photo);
      setSignature(stored.signature);
      setReceivedBy(stored.receivedBy);
      setTypeId(stored.typeId ?? null);
      setPhotos((stored.photos ?? []) as UploadFile[]);
      setAnswers(stored.answers ?? {});
      setDescription(stored.description ?? "");
      receiptPrecheck.restore(stored.precheck);
    },
  });

  // The type the screen renders: the chosen one while it is still offered,
  // else the default (or the only one). Null = the legacy proof.
  const type = useMemo(() => {
    if (choice.mode === "legacy") return null;
    if (choice.mode === "single") return choice.type;

    return choice.types.find((entry) => entry.id === typeId) ?? choice.initial;
  }, [choice, typeId]);

  const sections = deliveredSectionsOf(type);
  const form = useMemo(() => typeFormOf(type), [type]);
  const formCheck = useMemo(() => checkOccurrenceForm(form, answers), [form, answers]);

  // Typing is debounced; a photo or a signature is saved at once — they are
  // what a kill would cost the most.
  useEffect(() => {
    if (draft.isReady) draft.schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receivedBy, answers, description]);

  useEffect(() => {
    if (draft.isReady) draft.saveNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, signature, photos, typeId]);

  /** Moves a new file into the draft's directory and drops the one it replaces. */
  const keepInDraft = async (
    file: UploadFile,
    label: string,
    replaced: UploadFile | null,
  ): Promise<UploadFile> => {
    try {
      const submissionId = await draft.submissionId();
      const kept = persistDeliveryDraftFile(
        "delivery-proof",
        file,
        submissionId,
        label,
      );

      deleteDeliveryDraftFile("delivery-proof", replaced);

      return kept;
    } catch {
      // No session to keep it under: the file still serves this send.
      return file;
    }
  };

  const pendingCapture = useMemo<PendingCaptureMarker<DeliveryCaptureTarget> | null>(
    () =>
      userId && delivery && !reviewId
        ? {
            ownerId: userId,
            target: {
              kind: "delivery-proof",
              businessId,
              deliveryId: delivery.id,
            },
          }
        : null,
    [userId, businessId, delivery, reviewId],
  );

  const capture = useImageCapture({
    purpose: "delivery-proof",
    pendingCapture,
    onCapture: async (asset) => {
      // Read when the camera returns, before the copy into the draft: the
      // receipt's `photo_taken_at` (proof design §8.2).
      const takenAt = new Date().toISOString();

      setPhoto(
        await keepInDraft(
          {
            uri: asset.uri,
            fileName: asset.fileName,
            fileSize: asset.fileSize,
            mimeType: asset.mimeType,
            takenAt,
          },
          "photo",
          photo,
        ),
      );
    },
  });

  // Additional photos (decision 14.3), camera only like the receipt. No
  // pending-capture marker: a capture recovered after a kill belongs to the
  // receipt slot, which is the one the marker names.
  const extraCapture = useImageCapture({
    purpose: "delivery-proof",
    pendingCapture: null,
    onCapture: async (asset) => {
      const kept = await keepInDraft(
        {
          uri: asset.uri,
          fileName: asset.fileName,
          fileSize: asset.fileSize,
          mimeType: asset.mimeType,
        },
        `extra-${Date.now()}`,
        null,
      );

      setPhotos((current) => [...current, kept].slice(0, DELIVERED_MAX_PHOTOS));
    },
  });

  // The receipt just taken (or recovered, or restored without a check) is
  // read once; a result about a photo replaced since is never used.
  const { enabled: precheckEnabled, stored: precheckStored, run: runPrecheck } = receiptPrecheck;
  const invoiceNumber = delivery?.invoice_number ?? null;
  const timeZone = journey?.time_zone;

  useEffect(() => {
    const uri = photo?.uri;

    if (!precheckEnabled || !uri || reviewId) return;
    if (precheckApplies(precheckStored, uri)) return;

    void runPrecheck({
      photoUri: uri,
      invoiceNumber,
      businessDay: businessDayOf(new Date(), timeZone),
    });
  }, [precheckEnabled, photo?.uri, precheckStored, runPrecheck, invoiceNumber, timeZone, reviewId]);

  // A finished check is kept with the draft at once, like the photo.
  useEffect(() => {
    if (draft.isReady && precheckStored) draft.saveNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precheckStored]);

  const receiptWarning = proofWarning(receiptPrecheck.visibleFor(photo?.uri), invoiceNumber);

  const receivedByError = receivedByErrorOf(receivedBy);

  // Under review the files are the queued item's own, already on their way.
  const missing = deliveredMissing(
    type,
    reviewItem
      ? queuedDeliveredFiles(reviewItem.photos)
      : {
          receiptPhoto: photo !== null,
          signature: signature !== null,
          photos: photos.length,
        },
  );

  // A failed queued proof is not the request the tower holds.
  const waitingTower =
    delivery && !reviewItem ? deliveredRequestPending(delivery, deliveredTypes) : false;

  // Sending a review waits while the current form is fetched.
  const formState = reviewFormState({
    reason: queuedReview?.reason ?? null,
    typeListed: type !== null,
    refresh: formRefresh,
  });

  // Every message the screen can show, in screen order: each missing file
  // under its own section, the first invalid field is where a tap scrolls to.
  const issues = proofScreenIssues({
    missing,
    receivedByError,
    formErrors: formCheck.errors,
  });
  const issueOrder = proofScreenOrder(form.fields);
  const live = useLiveFieldMessages(liveState, { issues, order: issueOrder });
  const fieldErrors = live.visible;
  const { touch } = live;

  const changeAnswer = (key: string, value: DraftAnswer) => {
    setAnswers((current) => ({ ...current, [key]: value }));

    // A choice is a complete answer; a typed one waits for the blur.
    const field = form.fields?.find((entry) => entry.key === key);
    if (!field || answerTouchesOnChange(field)) touch(key);
  };

  const chooseType = (id: string) => {
    if (id === type?.id) return;

    // Another type is another form: receipt and signature stay, the answers
    // the new form does not have are dropped (design §8.2).
    setTypeId(id);
    live.reset();
  };

  // Reviewed under another company, this screen would offer that company's
  // types, and the resend would be refused for good (404).
  if (reviewEntry === "other-company" || reviewEntry === "no-review" || reviewEntry === "gone") {
    const copy = {
      "other-company": {
        icon: "business-outline" as const,
        title: "Este envio é de outra empresa",
        text: "Ele não pode ser revisado neste acesso. Descarte-o em Envios pendentes ou fale com o gestor.",
      },
      "no-review": {
        icon: "time-outline" as const,
        title: "Este envio não precisa de revisão",
        text: "Ele já foi revisado ou aguarda outra ação. Acompanhe em Envios pendentes.",
      },
      gone: {
        icon: "checkmark-done-outline" as const,
        title: "Este envio não está mais na fila",
        text: "Ele já foi enviado ou descartado. Os envios pendentes estão atualizados.",
      },
    }[reviewEntry];

    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
          <Ionicons name={copy.icon} size={44} color={colors.muted} />
          <Text className="mt-3 text-center text-base font-medium text-ink-soft">
            {copy.title}
          </Text>
          <Text className="mb-4 mt-1 text-center text-sm text-muted">{copy.text}</Text>
          <Button onPress={() => router.back()}>Voltar</Button>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  if (!delivery && !reviewItem) {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
          <Ionicons name="checkmark-done-outline" size={44} color={colors.muted} />
          <Text className="mt-3 text-center text-base font-medium text-ink-soft">
            Esta entrega saiu da sua lista
          </Text>
          <Text className="mb-4 mt-1 text-center text-sm text-muted">
            Ela foi concluída ou saiu da rota. A lista do dia está atualizada.
          </Text>
          <Button onPress={() => router.back()}>Voltar</Button>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  const submitReview = async (item: OutboxItem) => {
    if (!type) return;

    setIsRevising(true);

    try {
      const revised = await reviseQueuedDelivered(item, {
        businessId,
        type,
        // Only the answers the chosen form has.
        answers: Object.fromEntries(
          Object.entries(answers).filter(([key]) =>
            (form.fields ?? []).some((field) => field.key === key),
          ),
        ),
        receivedBy,
        description,
      });

      Toast.show(
        revised
          ? {
              type: "success",
              text1: "Entrega revisada",
              text2: "Enviando para a empresa. Acompanhe em Envios pendentes.",
              position: "top",
            }
          : {
              type: "info",
              text1: "Este envio não está mais na fila",
              text2: "Ele já foi enviado ou descartado.",
              position: "top",
            },
      );

      router.back();
    } catch (error) {
      if (error instanceof OccurrenceFormError) setAttempted(true);

      Toast.show({
        type: "error",
        text1: "Não foi possível revisar a entrega.",
        text2: error instanceof Error ? error.message : undefined,
        position: "top",
        visibilityTime: 6000,
      });
    } finally {
      setIsRevising(false);
    }
  };

  const handleSubmit = async () => {
    // Every field says what it needs now, nothing leaves the screen, and the
    // first invalid one is brought into view.
    const firstInvalid = live.attempt();

    if (firstInvalid) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => undefined,
      );
      fieldFocus.focusField(firstInvalid, issues[firstInvalid] ?? undefined);
      return;
    }

    if (waitingTower) return;

    if (reviewItem) {
      if (!formState.canSend || Object.keys(formCheck.errors).length > 0) return;

      await submitReview(reviewItem);
      return;
    }

    if (!delivery) return;

    // The draft's id: a second tap after a crash is the same submission.
    const submissionId = await draft.submissionId().catch(() => undefined);

    let done: boolean;

    if (!type) {
      if (!photo) return;

      // A day cached before the types: the installed contract's proof.
      done = await actions.submitProof({
        deliveryId: delivery.id,
        recipientName: delivery.recipient_name,
        photo,
        signature,
        receivedBy,
        submissionId,
        devicePrecheck: precheckForSubmit(precheckStored, photo.uri),
      });
    } else {
      if (Object.keys(formCheck.errors).length > 0) return;

      done = await actions.submitDelivered({
        deliveryId: delivery.id,
        recipientName: delivery.recipient_name,
        type,
        receiptPhoto: photo,
        signature,
        photos,
        receivedBy,
        description,
        // Only the answers the chosen form has.
        answers: Object.fromEntries(
          Object.entries(answers).filter(([key]) =>
            (form.fields ?? []).some((field) => field.key === key),
          ),
        ),
        submissionId,
        devicePrecheck: precheckForSubmit(precheckStored, photo?.uri),
      }).catch((error: unknown) => {
        if (error instanceof OccurrenceFormError) setAttempted(true);
        return false;
      });
    }

    if (!done) return;

    if (submissionId) await draft.finish(submissionId);

    router.back();
  };

  return (
    <ProtectedRoute>
      <SafeAreaView className="flex-1 bg-background">
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-border bg-surface px-4 py-3">
          <TouchableOpacity
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-lg font-semibold text-ink">
              {reviewItem ? "Revisar entrega" : "Comprovar entrega"}
            </Text>
            <Text className="text-xs text-muted" numberOfLines={1}>
              {delivery?.recipient_name ?? reviewItem?.vehicleLabel ?? ""}
            </Text>
          </View>
        </View>

        <StatusBanners />

        {/* The footer rides inside it too, so "Confirmar entrega" rises above
        the keyboard with the field being typed in (MOB-17). */}
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView
            ref={fieldFocus.scrollRef}
            className="flex-1 px-4 py-4"
            keyboardShouldPersistTaps="handled"
          >
            {/* Why the proof is on screen again, and what is being fetched. */}
            {queuedReview && (
              <View className="mb-4 rounded-xl border border-warning/40 bg-warning-soft p-3">
                <Text className="text-sm text-warning">{queuedReview.message}</Text>
                {formState.notice ? (
                  <Text className="mt-1 text-xs text-ink-soft">{formState.notice}</Text>
                ) : null}
              </View>
            )}

            {waitingTower && (
              <View className="mb-4 rounded-xl border border-warning/40 bg-warning-soft p-3">
                <Text className="text-sm font-medium text-warning">
                  {DELIVERED_PENDING_LABEL}
                </Text>
                <Text className="mt-1 text-xs text-ink-soft">
                  A torre ainda vai decidir a entrega registrada. Você pode
                  registrar uma ocorrência enquanto isso.
                </Text>
              </View>
            )}

            {/* Decision 14.3: which delivery type, when the company has more than one. */}
            {choice.mode === "pick" && (
              <View className="mb-4">
                <Text className="mb-2 text-sm font-medium text-ink">
                  Tipo de entrega <Text className="text-destructive">*</Text>
                </Text>
                <View accessibilityRole="radiogroup" className="gap-2">
                  {choice.types.map((option) => {
                    const selected = option.id === type?.id;

                    return (
                      <TouchableOpacity
                        key={option.id}
                        onPress={() => chooseType(option.id)}
                        disabled={actions.isSubmitting}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        className={`rounded-xl border px-3 py-3 ${
                          selected ? "border-primary bg-primary-soft" : "border-border bg-card"
                        }`}
                      >
                        <Text className="text-sm font-semibold text-ink">{option.name}</Text>
                        {option.description ? (
                          <Text className="text-xs text-muted">{option.description}</Text>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Under review: what was collected at the stop, kept as queued. */}
            {reviewItem ? (
              <View className="mb-4">
                <Text className="mb-1 text-sm font-medium text-ink">
                  Registrado na entrega
                </Text>
                <Text className="mb-2 text-xs text-muted">
                  O canhoto, a assinatura e as fotos já estão na fila e não mudam.
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {reviewItem.photos.map((file) => (
                    <Image
                      key={file.uri}
                      source={{ uri: file.uri }}
                      // A signature is dark ink on white paper: its tile stays white.
                      className={`h-16 w-16 rounded-lg border border-border ${
                        file.fieldName === "signature" ? "bg-white" : "bg-subtle"
                      }`}
                      resizeMode={file.fieldName === "signature" ? "contain" : "cover"}
                      accessibilityLabel={
                        file.fieldName === "receipt_photo"
                          ? "Foto do canhoto"
                          : file.fieldName === "signature"
                            ? "Assinatura"
                            : "Foto da entrega"
                      }
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {!reviewItem ? (
              <>
            {/* Receipt photo — the proof itself */}
            {/* The default type's marks are the literal ones ("Entrega normal":
            receipt required, signature optional); the site's phone mockup
            is held to them (trajetto-ui phone-mockup.test.ts). */}
            <FieldAnchor name={SCREEN_FIELDS.receipt} focus={fieldFocus}>
            {sections.receipt === "required" ? (
              <Text className="mb-1 text-sm font-medium text-ink">
                Foto do canhoto <Text className="text-destructive">*</Text>
              </Text>
            ) : (
              <Text className="mb-1 text-sm font-medium text-ink">
                {RECEIPT_LABEL} <Text className="font-normal text-muted">(opcional)</Text>
              </Text>
            )}
            <Text className="mb-2 text-xs text-muted">
              Fotografe agora o canhoto assinado da nota. É a prova da entrega.
            </Text>

            {photo ? (
              <View className="mb-4">
                <Image
                  source={{ uri: photo.uri }}
                  className="h-48 w-full rounded-xl bg-subtle"
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={() => void capture.takePhoto()}
                  disabled={actions.isSubmitting}
                  accessibilityRole="button"
                  className="mt-2 self-start"
                >
                  <Text className="text-sm font-medium text-primary">
                    Fotografar novamente
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => void capture.takePhoto()}
                disabled={actions.isSubmitting}
                testID="proof-receipt-photo"
                accessibilityRole="button"
                accessibilityLabel={
                  fieldErrors[SCREEN_FIELDS.receipt]
                    ? `Tirar foto do canhoto. ${fieldErrors[SCREEN_FIELDS.receipt]}`
                    : "Tirar foto do canhoto"
                }
                // Neutral until the photo is actually missing (decision 16.700).
                className={`mb-4 items-center rounded-xl border-2 border-dashed py-8 ${
                  fieldErrors[SCREEN_FIELDS.receipt]
                    ? "border-destructive bg-destructive-soft"
                    : "border-input bg-card"
                }`}
              >
                <Ionicons
                  name="camera-outline"
                  size={28}
                  color={fieldErrors[SCREEN_FIELDS.receipt] ? colors.destructive : colors.muted}
                />
                <Text className="mt-1 text-sm text-muted">
                  Tirar foto do canhoto
                </Text>
                {fieldErrors[SCREEN_FIELDS.receipt] ? (
                  <Text className="mt-1 px-3 text-center text-sm text-destructive">
                    {fieldErrors[SCREEN_FIELDS.receipt]}
                  </Text>
                ) : null}
              </TouchableOpacity>
            )}
            </FieldAnchor>

            {photo && receiptWarning ? (
              <PrecheckNotice
                message={receiptWarning}
                disabled={actions.isSubmitting}
                actions={[
                  { label: "Tirar outra", onPress: () => void capture.takePhoto() },
                  { label: "Enviar assim", onPress: receiptPrecheck.dismiss },
                ]}
              />
            ) : null}

            {/* On-screen signature — completes the proof */}
            <FieldAnchor name={SCREEN_FIELDS.signature} focus={fieldFocus}>
            {sections.signature === "required" ? (
              <Text className="mb-1 text-sm font-medium text-ink">
                {SIGNATURE_LABEL} <Text className="text-destructive">*</Text>
              </Text>
            ) : (
              <Text className="mb-1 text-sm font-medium text-ink">
                Assinatura na tela{" "}
                <Text className="font-normal text-muted">(opcional)</Text>
              </Text>
            )}

            {signature ? (
              <View className="mb-4">
                <Image
                  source={{ uri: signature.uri }}
                  // The signature is dark ink on white paper (signature-pad.tsx):
                  // its preview keeps the paper in both themes.
                  className="h-28 w-full rounded-xl border border-border bg-white"
                  resizeMode="contain"
                />
                <TouchableOpacity
                  onPress={() => setIsSignatureOpen(true)}
                  disabled={actions.isSubmitting}
                  className="mt-2 self-start"
                >
                  <Text className="text-sm font-medium text-primary">
                    Assinar novamente
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setIsSignatureOpen(true)}
                disabled={actions.isSubmitting}
                testID="proof-signature"
                accessibilityRole="button"
                accessibilityLabel={
                  fieldErrors[SCREEN_FIELDS.signature]
                    ? `Colher assinatura do recebedor. ${fieldErrors[SCREEN_FIELDS.signature]}`
                    : "Colher assinatura do recebedor"
                }
                className={`mb-4 items-center rounded-xl border-2 border-dashed py-6 ${
                  fieldErrors[SCREEN_FIELDS.signature]
                    ? "border-destructive bg-destructive-soft"
                    : "border-input bg-card"
                }`}
              >
                <Ionicons
                  name="create-outline"
                  size={26}
                  color={fieldErrors[SCREEN_FIELDS.signature] ? colors.destructive : colors.muted}
                />
                <Text className="mt-1 text-sm text-muted">
                  Colher assinatura do recebedor
                </Text>
                {fieldErrors[SCREEN_FIELDS.signature] ? (
                  <Text className="mt-1 px-3 text-center text-sm text-destructive">
                    {fieldErrors[SCREEN_FIELDS.signature]}
                  </Text>
                ) : null}
              </TouchableOpacity>
            )}
            </FieldAnchor>

            {sections.photos && (
              <FieldAnchor name={SCREEN_FIELDS.photos} focus={fieldFocus} className="mb-4">
                <Text className="mb-1 text-sm font-medium text-ink">
                  Fotos da entrega <Text className="text-destructive">*</Text>
                </Text>
                <Text className="mb-2 text-xs text-muted">
                  Até {DELIVERED_MAX_PHOTOS} fotos, pela câmera.
                </Text>
                {photos.map((extra, index) => (
                  <View key={extra.uri} className="mb-2 flex-row items-center gap-3">
                    <Image
                      source={{ uri: extra.uri }}
                      className="h-16 w-16 rounded-lg bg-subtle"
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      onPress={() => {
                        setPhotos((current) => current.filter((_, at) => at !== index));

                        // Taking one away is visiting the area: if it was the
                        // last, the requirement shows now.
                        touch(SCREEN_FIELDS.photos);
                      }}
                      disabled={actions.isSubmitting}
                      accessibilityRole="button"
                      accessibilityLabel={`Remover foto ${index + 1}`}
                    >
                      <Text className="text-sm font-medium text-destructive">Remover</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {photos.length < DELIVERED_MAX_PHOTOS && (
                  <TouchableOpacity
                    onPress={() => void extraCapture.takePhoto()}
                    disabled={actions.isSubmitting}
                    accessibilityRole="button"
                    className={`items-center rounded-xl border-2 border-dashed py-4 ${
                      fieldErrors[SCREEN_FIELDS.photos]
                        ? "border-destructive bg-destructive-soft"
                        : "border-input bg-card"
                    }`}
                  >
                    <Ionicons
                      name="images-outline"
                      size={24}
                      color={fieldErrors[SCREEN_FIELDS.photos] ? colors.destructive : colors.muted}
                    />
                    <Text className="mt-1 text-sm text-muted">Adicionar foto</Text>
                  </TouchableOpacity>
                )}
                {fieldErrors[SCREEN_FIELDS.photos] ? (
                  <Text className="mt-1 text-sm text-destructive">
                    {fieldErrors[SCREEN_FIELDS.photos]}
                  </Text>
                ) : null}
              </FieldAnchor>
            )}

              </>
            ) : null}

            <FieldAnchor name={SCREEN_FIELDS.receivedBy} focus={fieldFocus}>
              <Input
                label="Quem recebeu (opcional)"
                testID="proof-received-by"
                inputRef={fieldFocus.inputRef(SCREEN_FIELDS.receivedBy)}
                placeholder="Nome de quem assinou"
                value={receivedBy}
                onChangeText={setReceivedBy}
                onBlur={() => touch(SCREEN_FIELDS.receivedBy)}
                autoCapitalize="words"
                error={fieldErrors[SCREEN_FIELDS.receivedBy]}
              />
            </FieldAnchor>

            {form.fields && form.fields.length > 0 ? (
              <View className="mt-4">
                <OccurrenceFormFields
                  fields={form.fields}
                  answers={answers}
                  errors={fieldErrors}
                  onChange={changeAnswer}
                  onBlur={touch}
                  fieldFocus={fieldFocus}
                  disabled={actions.isSubmitting}
                />
              </View>
            ) : null}

            {type ? (
              <View className="mt-4">
                <Input
                  label="Descrição (opcional)"
                  placeholder="Algo que a operação deva saber"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                />
              </View>
            ) : null}

            {/* Under review the files are the queued ones, not on screen: what
            they lack is said here. Otherwise each section shows its own. */}
            {reviewItem && attempted && missing.length > 0 ? (
              <Text className="mt-3 text-sm text-destructive">{missing[0].message}</Text>
            ) : null}

            {actions.uploadProgress && (
              <View className="mt-4">
                <UploadProgressBar progress={actions.uploadProgress} />
              </View>
            )}

            {/* Room below the last field, so it never sits flush against the
            footer while typing. */}
            <View className="h-6" />
          </ScrollView>

          <View className="border-t border-border bg-surface px-4 py-3">
            <Button
              onPress={handleSubmit}
              testID="proof-submit"
              // Enabled while idle (decision 16.701): the tap shows what is
              // missing. The tower deciding, a review without its type or form,
              // and sending are the real reasons to wait.
              disabled={
                (reviewItem ? type === null || !formState.canSend : false) ||
                waitingTower ||
                actions.isSubmitting ||
                isRevising
              }
              loading={actions.isSubmitting || isRevising}
              fullWidth
            >
              {reviewItem ? "Enviar revisão" : "Confirmar entrega"}
            </Button>
          </View>
        </KeyboardAvoidingView>

        <SignaturePad
          visible={isSignatureOpen}
          onClose={() => setIsSignatureOpen(false)}
          onCapture={(dataUrl) => {
            const replaced = signature;

            void keepInDraft(saveSignatureToFile(dataUrl), "signature", replaced)
              .then(setSignature);
          }}
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default DeliveryProofScreen;
