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

import { ProtectedRoute } from "../../components/protected-route";
import { StatusBanners } from "../../components/status-banners";
import { OccurrenceFormFields } from "../../components/screens/occurrences/occurrence-form-fields";
import { FieldAnchor } from "../../components/forms/field-anchor";

import {
  Button,
  ImagePickerBottomSheet,
  Input,
  Select,
  UploadProgressBar,
} from "../../components/ui";

import { useAuthStore } from "@/store/auth-store";
import { useOutboxStore } from "@/store/outbox-store";
import { useThemeColors } from "@/hooks/use-theme";

import { useImageCapture } from "@/features/media/use-image-capture";
import type { PendingCaptureMarker } from "@/features/media/pending-capture";
import { useMyDeliveries } from "@/features/deliveries/hooks/use-my-deliveries";

import { useDeliveryActions } from "@/features/deliveries/hooks/use-delivery-actions";
import { useDeliveryDraft } from "@/features/deliveries/hooks/use-delivery-draft";
import { occurrenceNeedsPhoto } from "@/features/deliveries/delivery-rules";
import {
  deleteDeliveryDraftFile,
  loadOccurrenceDraft,
  persistDeliveryDraftFile,
  saveOccurrenceDraft,
} from "@/features/deliveries/delivery-draft";
import type {
  DeliveryCaptureTarget,
  OccurrenceDraft,
} from "@/features/deliveries/delivery-draft-rules";

import {
  OccurrenceFormError,
  answerTouchesOnChange,
  checkOccurrenceForm,
  typeFormOf,
} from "@/features/occurrences/occurrence-form";
import {
  SCREEN_FIELDS,
  occurrenceScreenIssues,
  occurrenceScreenOrder,
} from "@/features/deliveries/delivery-form-issues";
import { useLiveFieldMessages, useLiveFieldState } from "@/features/forms/use-live-fields";
import { useFieldFocus } from "@/features/forms/use-field-focus";
import {
  draftAnswersOf,
  type DraftAnswer,
  type DraftAnswers,
} from "@/features/occurrences/draft-answers";
import {
  REVIEW_COPY,
  occurrenceReviewOf,
  refusalScreenChange,
  reviewEntryOf,
  reviewFormState,
} from "@/features/occurrences/occurrence-queue-rules";
import { reviseQueuedOccurrence } from "@/features/occurrences/occurrence-review";
import { useFormRefresh } from "@/features/occurrences/use-form-refresh";
import { OCCURRENCE_KIND } from "@/features/occurrences/authorization-rules";

import {
  OCCURRENCE_DESCRIPTION_MAX_LENGTH,
  deliveryOccurrenceFormSchema,
} from "@/schemas/delivery";
import { normalizeMultilineText } from "@/schemas/text-rules";

import type { UploadFile } from "@/features/media/upload-to-storage";
import type { OutboxItem } from "@/features/submissions/outbox";

/** The first message the form would show for the description, if any. */
const descriptionErrorOf = (value: string): string | undefined => {
  const parsed = deliveryOccurrenceFormSchema.shape.description.safeParse(
    normalizeMultilineText(value),
  );

  return parsed.success ? undefined : parsed.error.issues[0]?.message;
};

/**
 * A typed report of what went wrong at the stop, as a routed screen — not
 * an RN Modal — because the image picker bottom sheet and the toasts render
 * through the app root's portal, and a native Modal sits above that portal
 * and hides them. A photo-required type refuses a bare report before
 * anything enters the queue; a blocking type warns that the delivery flips
 * to Insucesso.
 *
 * The type's form (decision 6.2) is drawn from the day's payload and checked
 * with the API's rules before anything is sent or queued; a type that asks
 * the tower (6.3) says so before the tap.
 *
 * Kept on disk while it is filled, like the proof (MOB-12). Occurrences keep
 * the gallery: a picture of the damage taken a minute earlier is still
 * evidence (`capture-policy`).
 *
 * With `review=<queued item id>` it reopens a queued report the API refused
 * over its form (contract §6): same answers, current form, same submission.
 * Only under the report's own company: this screen reads the catalog of the
 * company selected now. Without signal the current form cannot be fetched:
 * the driver can still send, and the report returns if the form changed.
 */
const DeliveryOccurrenceScreen = () => {
  const router = useRouter();
  const colors = useThemeColors();
  const { id, review } = useLocalSearchParams<{ id: string; review?: string }>();

  const reviewId = typeof review === "string" && review.length > 0 ? review : null;

  const userId = useAuthStore((state) => state.user?.id ?? null);

  const {
    businessId,
    deliveries,
    occurrenceTypes,
    isLoading: isListLoading,
    refetch,
  } = useMyDeliveries();
  const actions = useDeliveryActions(businessId);

  const [occurrenceTypeId, setOccurrenceTypeId] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [answers, setAnswers] = useState<DraftAnswers>({});

  // Errors show on the fields visited, and on all of them after a try
  // (decision 16.700).
  const liveState = useLiveFieldState();
  const { attempted, setAttempted } = liveState;
  const fieldFocus = useFieldFocus();

  // The API said the form changed since the list was cached.
  const [formChanged, setFormChanged] = useState<boolean>(false);

  // The reread of the day that brings the current form after a refusal;
  // "offline" instead of waiting on a fetch paused for lack of a network.
  const { refresh: formRefresh, request: refreshForm } = useFormRefresh({
    refetch,
    listLoading: isListLoading,
  });

  const [photo, setPhoto] = useState<UploadFile | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [isRevising, setIsRevising] = useState<boolean>(false);

  // The queued report under review, held from the moment it is found: once
  // revised it leaves the failed state, and the screen must not flip under
  // the driver's finger.
  const outboxItems = useOutboxStore((state) => state.items);
  const [reviewItem, setReviewItem] = useState<OutboxItem | null>(null);

  const listed = useMemo(
    () =>
      reviewId
        ? (outboxItems.find(
            (item) => item.id === reviewId && item.kind === OCCURRENCE_KIND,
          ) ?? null)
        : null,
    [outboxItems, reviewId],
  );

  const prefilled = useRef(false);

  useEffect(() => {
    if (!listed || prefilled.current) return;

    prefilled.current = true;
    setReviewItem(listed);

    // Another company's, or nothing to review: the screen says so instead.
    if (reviewEntryOf(listed, businessId) !== "open") return;

    const { body } = listed;

    setOccurrenceTypeId(
      typeof body.occurrenceTypeId === "string" ? body.occurrenceTypeId : "",
    );
    setDescription(typeof body.description === "string" ? body.description : "");
    setAnswers(draftAnswersOf(body.form_answers));
    setAttempted(true);

    // The current forms, not the ones this phone cached days ago.
    refreshForm();
  }, [listed, businessId, refreshForm]);

  const queuedReview = reviewItem ? occurrenceReviewOf(reviewItem) : null;

  // As first found: another company's report (its types are not in this
  // catalog), one with nothing to review, or one no longer on the phone.
  const reviewEntry = reviewId ? reviewEntryOf(reviewItem ?? listed, businessId) : null;

  const delivery = useMemo(
    () => deliveries.find((entry) => entry.id === id) ?? null,
    [deliveries, id],
  );

  const selectedType = useMemo(
    () => occurrenceTypes.find((type) => type.id === occurrenceTypeId) ?? null,
    [occurrenceTypes, occurrenceTypeId],
  );

  const form = useMemo(() => typeFormOf(selectedType), [selectedType]);
  const check = useMemo(() => checkOccurrenceForm(form, answers), [form, answers]);

  // Under review the photos are the queued item's own, already on their way.
  const photoCount = reviewItem ? reviewItem.photos.length : photo ? 1 : 0;

  const missingPhoto = selectedType
    ? occurrenceNeedsPhoto(selectedType, photoCount)
    : false;

  // Held to the report's type unless it was switched off or left the list;
  // sending waits while the current form is fetched.
  const formState = reviewFormState({
    reason: queuedReview?.reason ?? null,
    typeListed: selectedType !== null,
    refresh: formRefresh,
  });

  const draft = useDeliveryDraft<OccurrenceDraft>({
    kind: "delivery-occurrence",
    userId,
    businessId,
    // A review lives in the queue item; a draft would be a second copy.
    deliveryId: reviewId ? null : (delivery?.id ?? null),
    load: loadOccurrenceDraft,
    save: saveOccurrenceDraft,
    build: (submissionId) => ({
      submissionId,
      occurrenceTypeId,
      description,
      photo,
      answers,
      updatedAt: new Date().toISOString(),
    }),
    restore: (stored) => {
      setOccurrenceTypeId(stored.occurrenceTypeId);
      setDescription(stored.description);
      setPhoto(stored.photo);
      setAnswers(stored.answers ?? {});
    },
  });

  useEffect(() => {
    if (draft.isReady) draft.schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occurrenceTypeId, description, answers]);

  useEffect(() => {
    if (draft.isReady) draft.saveNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  const pendingCapture = useMemo<PendingCaptureMarker<DeliveryCaptureTarget> | null>(
    () =>
      userId && delivery && !reviewId
        ? {
            ownerId: userId,
            target: {
              kind: "delivery-occurrence",
              businessId,
              deliveryId: delivery.id,
            },
          }
        : null,
    [userId, businessId, delivery, reviewId],
  );

  const capture = useImageCapture({
    purpose: "delivery-occurrence",
    pendingCapture,
    onCapture: async (asset) => {
      const picked: UploadFile = {
        uri: asset.uri,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        mimeType: asset.mimeType,
      };

      let kept = picked;

      try {
        const submissionId = await draft.submissionId();

        kept = persistDeliveryDraftFile(
          "delivery-occurrence",
          picked,
          submissionId,
          "photo",
        );

        deleteDeliveryDraftFile("delivery-occurrence", photo);
      } catch {
        // No session to keep it under: the file still serves this send.
      }

      setPhoto(kept);
      setIsPickerOpen(false);
    },
  });

  const descriptionError = descriptionErrorOf(description);

  // Every message the screen can show, in screen order: the first invalid
  // one is where a failed tap scrolls to.
  const issues = occurrenceScreenIssues({
    hasType: selectedType !== null,
    formErrors: check.errors,
    descriptionError,
    missingPhoto,
  });
  const issueOrder = occurrenceScreenOrder(form.fields);
  const live = useLiveFieldMessages(liveState, { issues, order: issueOrder });
  const fieldErrors = live.visible;
  const { touch } = live;

  const changeAnswer = (key: string, value: DraftAnswer) => {
    setAnswers((current) => ({ ...current, [key]: value }));

    // A choice is a complete answer; a typed one waits for the blur.
    const field = form.fields?.find((entry) => entry.key === key);
    if (!field || answerTouchesOnChange(field)) touch(key);
  };

  const changeType = (typeId: string) => {
    if (typeId === occurrenceTypeId) return;

    // Another type is another form: its fields start untouched.
    setOccurrenceTypeId(typeId);
    live.reset({ attempted: Boolean(reviewItem) });
    setFormChanged(false);
  };

  // Reviewed under another company, this screen would offer that company's
  // types, and the resend would be refused for good (404). Only a MASTER
  // switches company, so the driver is not told to.
  if (reviewEntry === "other-company") {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
          <Ionicons name="business-outline" size={44} color={colors.muted} />
          <Text className="mt-3 text-center text-base font-medium text-ink-soft">
            Este envio é de outra empresa
          </Text>
          <Text className="mb-4 mt-1 text-center text-sm text-muted">
            Ele não pode ser revisado neste acesso. Descarte-o em Envios pendentes ou fale com o gestor.
          </Text>
          <Button onPress={() => router.back()}>Voltar</Button>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  // Still on the phone, but not refused over its form (already revised and
  // waiting, or failed for another reason): a form here could only fail.
  if (reviewEntry === "no-review") {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
          <Ionicons name="time-outline" size={44} color={colors.muted} />
          <Text className="mt-3 text-center text-base font-medium text-ink-soft">
            Este envio não precisa de revisão
          </Text>
          <Text className="mb-4 mt-1 text-center text-sm text-muted">
            Ele já foi revisado ou aguarda outra ação. Acompanhe em Envios pendentes.
          </Text>
          <Button onPress={() => router.back()}>Voltar</Button>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  // A review whose item is gone (sent, discarded) has nothing to reopen.
  if (reviewEntry === "gone") {
    return (
      <ProtectedRoute>
        <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
          <Ionicons name="checkmark-done-outline" size={44} color={colors.muted} />
          <Text className="mt-3 text-center text-base font-medium text-ink-soft">
            Este envio não está mais na fila
          </Text>
          <Text className="mb-4 mt-1 text-center text-sm text-muted">
            Ele já foi enviado ou descartado. Os envios pendentes estão atualizados.
          </Text>
          <Button onPress={() => router.back()}>Voltar</Button>
        </SafeAreaView>
      </ProtectedRoute>
    );
  }

  if (!delivery && !reviewId) {
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

  const isBusy = actions.isSubmitting || isRevising;

  // Enabled while idle (decision 16.701): the tap shows what is missing.
  // Busy and a form still being fetched are the real reasons to wait.
  const canSubmit = !isBusy && formState.canSend;

  // What the API said at the tap, besides the toast: a form that changed is
  // re-read and shown with the answers kept; a type switched off is dropped.
  const handleRefusal = (error: unknown) => {
    const change = refusalScreenChange(error);
    if (!change) return;

    if (change.markFields) setAttempted(true);
    if (change.formChanged) setFormChanged(true);
    if (change.clearType) changeType("");
    if (change.refetch) refreshForm();
  };

  const submitReview = async (item: OutboxItem) => {
    if (!selectedType) return;

    setIsRevising(true);

    try {
      const revised = await reviseQueuedOccurrence(item, {
        // The catalog the type and form were read from (checked against the
        // report's own company before anything is queued).
        businessId,
        occurrenceTypeId: selectedType.id,
        description,
        form,
        answers,
      });

      Toast.show(
        revised
          ? {
              type: "success",
              text1: "Ocorrência revisada",
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
        text1: "Não foi possível revisar a ocorrência.",
        text2: error instanceof Error ? error.message : undefined,
        position: "top",
        visibilityTime: 6000,
      });
    } finally {
      setIsRevising(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    // Every field says what it needs now, nothing leaves the screen, and the
    // first invalid one is brought into view.
    const firstInvalid = live.attempt();

    if (firstInvalid || !selectedType) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => undefined,
      );
      const field = firstInvalid ?? SCREEN_FIELDS.type;
      fieldFocus.focusField(field, issues[field] ?? undefined);
      return;
    }

    if (reviewItem) {
      await submitReview(reviewItem);
      return;
    }

    if (!delivery) return;

    const submissionId = await draft.submissionId().catch(() => undefined);

    const done = await actions.reportOccurrence({
      deliveryId: delivery.id,
      recipientName: delivery.recipient_name,
      occurrenceTypeId: selectedType.id,
      description,
      photo,
      submissionId,
      occurrenceType: selectedType,
      answers,
      onRefused: handleRefusal,
    });

    if (!done) return;

    if (submissionId) await draft.finish(submissionId);

    router.back();
  };

  const subtitle = delivery?.recipient_name ?? reviewItem?.vehicleLabel ?? "";
  const reviewPhoto = reviewItem?.photos[0]?.uri ?? null;

  // Why the form is on screen again: the queued refusal, or the API's answer
  // to the tap a moment ago.
  const reopenedBecause =
    queuedReview?.message ??
    (formChanged ? REVIEW_COPY["form-outdated"].message : null);

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
              {reviewItem ? "Revisar ocorrência" : "Registrar ocorrência"}
            </Text>
            <Text className="text-xs text-muted" numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>

        <StatusBanners />

        {/* The footer rides inside it too, so the button rises above the
        keyboard with the description being typed (MOB-17). */}
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView
            ref={fieldFocus.scrollRef}
            className="flex-1 px-4 py-4"
            keyboardShouldPersistTaps="handled"
          >
            {reopenedBecause ? (
              <View
                accessibilityRole="alert"
                className="mb-3 flex-row items-start rounded-lg border border-warning/40 bg-warning-soft px-3 py-2"
              >
                <Ionicons name="create-outline" size={16} color={colors.warning} style={{ marginTop: 2 }} />
                <Text className="ml-2 flex-1 text-xs text-warning">
                  {reopenedBecause}
                </Text>
              </View>
            ) : null}

            {formState.notice ? (
              <View
                accessibilityLiveRegion="polite"
                className="mb-3 flex-row items-start rounded-lg border border-border bg-card px-3 py-2"
              >
                <Ionicons
                  name={
                    formRefresh === "failed" || formRefresh === "offline"
                      ? "cloud-offline-outline"
                      : "sync-outline"
                  }
                  size={16}
                  color={colors.muted}
                  style={{ marginTop: 2 }}
                />
                <View className="ml-2 flex-1">
                  <Text className="text-xs text-ink-soft">{formState.notice}</Text>
                  {/* Offline, the paused fetch resumes by itself on reconnect. */}
                  {formRefresh === "failed" ? (
                    <TouchableOpacity
                      onPress={refreshForm}
                      accessibilityRole="button"
                      className="mt-1 self-start"
                    >
                      <Text className="text-xs font-medium text-primary">
                        Buscar de novo
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            <FieldAnchor name={SCREEN_FIELDS.type} focus={fieldFocus}>
              <Select
                label="Tipo de ocorrência"
                testID="occurrence-type"
                placeholder="Selecione o que aconteceu"
                value={occurrenceTypeId}
                onValueChange={changeType}
                options={occurrenceTypes.map((type) => ({
                  label: type.name,
                  value: type.id,
                }))}
                disabled={formState.typeLocked || isBusy}
                required
                error={fieldErrors[SCREEN_FIELDS.type]}
              />
            </FieldAnchor>

            {selectedType?.description ? (
              <Text className="mb-2 mt-1 text-xs text-muted">
                {selectedType.description}
              </Text>
            ) : null}

            {selectedType?.requires_authorization ? (
              <View
                className="mb-3 mt-1 flex-row items-center rounded-lg
                bg-warning-soft px-3 py-2"
              >
                <Ionicons name="hourglass-outline" size={16} color={colors.warning} />
                <Text className="ml-2 flex-1 text-xs text-warning">
                  {selectedType.blocks_delivery
                    ? "Precisa de autorização da torre: a entrega só passa para Insucesso se a torre autorizar."
                    : "Precisa de autorização da torre antes de valer."}{" "}
                  A resposta chega aqui e por notificação; enquanto isso, você
                  ainda pode comprovar a entrega.
                </Text>
              </View>
            ) : selectedType?.blocks_delivery ? (
              <View
                className="mb-3 mt-1 flex-row items-center rounded-lg
                bg-destructive-soft px-3 py-2"
              >
                <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
                <Text className="ml-2 flex-1 text-xs text-destructive">
                  Ocorrência impeditiva: a entrega passa para Insucesso ao
                  registrar.
                </Text>
              </View>
            ) : null}

            {form.fields ? (
              <OccurrenceFormFields
                fields={form.fields}
                answers={answers}
                errors={fieldErrors}
                onChange={changeAnswer}
                onBlur={touch}
                fieldFocus={fieldFocus}
                disabled={isBusy}
              />
            ) : null}

            <FieldAnchor name={SCREEN_FIELDS.description} focus={fieldFocus} className="mt-4">
              <Input
                label="Descrição (opcional)"
                testID="occurrence-description"
                inputRef={fieldFocus.inputRef(SCREEN_FIELDS.description)}
                onBlur={() => touch(SCREEN_FIELDS.description)}
                placeholder="Conte o que aconteceu"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                error={fieldErrors[SCREEN_FIELDS.description]}
                editable={!isBusy}
              />
              <Text className="mt-1 text-right text-xs text-muted">
                {`${normalizeMultilineText(description).length}/${OCCURRENCE_DESCRIPTION_MAX_LENGTH}`}
              </Text>
            </FieldAnchor>

            <FieldAnchor name={SCREEN_FIELDS.photo} focus={fieldFocus}>
            <Text className="mb-1 mt-3 text-sm font-medium text-ink">
              Foto{" "}
              {selectedType?.requires_photo ? (
                <Text className="text-destructive">*</Text>
              ) : (
                <Text className="font-normal text-muted">(opcional)</Text>
              )}
            </Text>

            {selectedType?.requires_photo ? (
              <Text className="mb-2 text-xs text-muted">
                Este tipo de ocorrência exige foto anexada ao registro.
              </Text>
            ) : null}

            {reviewItem ? (
              // The queued photo goes as it is: it is what was seen then.
              reviewPhoto ? (
                <Image
                  source={{ uri: reviewPhoto }}
                  className="mb-4 h-48 w-full rounded-xl bg-subtle"
                  resizeMode="cover"
                />
              ) : (
                <Text className="mb-4 text-xs text-muted">
                  {missingPhoto
                    ? "Este tipo exige foto e o registro salvo não tem nenhuma: descarte-o em Envios pendentes e registre de novo."
                    : "Registro salvo sem foto."}
                </Text>
              )
            ) : photo ? (
              <View className="mb-4">
                <Image
                  source={{ uri: photo.uri }}
                  className="h-48 w-full rounded-xl bg-subtle"
                  resizeMode="cover"
                />
                <TouchableOpacity
                  onPress={() => setIsPickerOpen(true)}
                  disabled={isBusy}
                  className="mt-2 self-start"
                >
                  <Text className="text-sm font-medium text-primary">
                    Trocar foto
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setIsPickerOpen(true)}
                disabled={isBusy}
                testID="occurrence-photo"
                accessibilityRole="button"
                accessibilityLabel={
                  fieldErrors[SCREEN_FIELDS.photo]
                    ? `Fotografar a ocorrência. ${fieldErrors[SCREEN_FIELDS.photo]}`
                    : "Fotografar a ocorrência"
                }
                // Neutral until the photo is actually missing (decision 16.700).
                className={`mb-4 items-center rounded-xl border-2 border-dashed py-8 ${
                  fieldErrors[SCREEN_FIELDS.photo]
                    ? "border-destructive bg-destructive-soft"
                    : "border-input bg-card"
                }`}
              >
                <Ionicons
                  name="camera-outline"
                  size={28}
                  color={fieldErrors[SCREEN_FIELDS.photo] ? colors.destructive : colors.muted}
                />
                <Text className="mt-1 text-sm text-muted">
                  Fotografar a ocorrência
                </Text>
                {fieldErrors[SCREEN_FIELDS.photo] ? (
                  <Text className="mt-1 text-sm text-destructive">
                    {fieldErrors[SCREEN_FIELDS.photo]}
                  </Text>
                ) : null}
              </TouchableOpacity>
            )}
            </FieldAnchor>

            {actions.uploadProgress && (
              <View className="mt-2">
                <UploadProgressBar progress={actions.uploadProgress} />
              </View>
            )}

            <View className="h-6" />
          </ScrollView>

          <View className="border-t border-border bg-surface px-4 py-3">
            <Button
              onPress={handleSubmit}
              testID="occurrence-submit"
              disabled={!canSubmit}
              loading={isBusy}
              fullWidth
            >
              {reviewItem ? "Enviar revisão" : "Registrar ocorrência"}
            </Button>
          </View>
        </KeyboardAvoidingView>

        <ImagePickerBottomSheet
          visible={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          onTakePhoto={capture.takePhoto}
          onPickFromGallery={capture.pickFromGallery}
          title="Foto da ocorrência"
          description="Fotografe o que aconteceu na entrega."
        />
      </SafeAreaView>
    </ProtectedRoute>
  );
};

export default DeliveryOccurrenceScreen;
