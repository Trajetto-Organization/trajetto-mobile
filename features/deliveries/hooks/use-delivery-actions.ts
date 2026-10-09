import { useState } from "react";

import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";

import Toast from "react-native-toast-message";
import type { ZodType, ZodTypeDef } from "zod";

import { submitOrQueue } from "@/features/submissions/submit-or-queue";
import {
  queuedNotice,
  type QueuedOutcome,
} from "@/features/submissions/queue-decision";
import { queryClient } from "@/providers/query-provider";

import { captureLocation } from "@/features/tracking/capture-location";
import { chatContextParams } from "@/features/chat/chat-context";
import { deviceIdentity } from "@/features/device/device-identity";
import { photoTakenAtFor } from "@/features/device/device-identity-rules";
import { markDeliveryProofSubmitted } from "@/features/notifications/proof-feedback-store";

import {
  deliveredOccurrenceBodySchema,
  deliveryArrivalBodySchema,
  deliveryProofBodySchema,
} from "@/schemas/delivery";
import { normalizeSingleLineText } from "@/schemas/text-rules";

import { buildOccurrenceBody } from "@/features/occurrences/occurrence-payload";
import { typeFormOf } from "@/features/occurrences/occurrence-form";
import type { DraftAnswers } from "@/features/occurrences/draft-answers";
import {
  sentReportNotice,
  sentReportOf,
  withSentReport,
  type SentReport,
} from "@/features/occurrences/authorization-rules";

import { withStopArrived, type StartRouteTarget } from "../delivery-rules";
import type { DriverOccurrenceType, MyDeliveriesResponse } from "../types";
import {
  DELIVERED_KIND,
  deliveredFiles,
  deliveredMissing,
  deliveredSentNotice,
} from "../delivered-requirements";
import { occurrenceFormPart } from "@/features/occurrences/occurrence-form";

import type { UploadFile } from "@/features/media/upload-to-storage";
import type { DevicePrecheck } from "@/schemas/device-precheck";

interface ProofInput {
  deliveryId: string;
  recipientName: string;
  photo: UploadFile;
  signature?: UploadFile | null;
  receivedBy?: string;

  /**
   * The draft's submission id, when the screen kept one (MOB-12). Reusing it
   * makes a second tap after the app died mid-send the same submission to
   * the API, not a second proof.
   */
  submissionId?: string;

  /** The phone's offline check of this receipt photo (decision 14.2). */
  devicePrecheck?: DevicePrecheck;
}

/**
 * "Entregar" through a DELIVERED type (decision 14.3; contract 3): the
 * report route with the type's requirements, instead of the legacy proof.
 */
interface DeliveredInput {
  deliveryId: string;
  recipientName: string;
  type: DriverOccurrenceType;
  receiptPhoto: UploadFile | null;
  signature: UploadFile | null;
  photos: UploadFile[];
  receivedBy?: string;
  description?: string;
  answers?: DraftAnswers;
  submissionId?: string;

  /** The phone's offline check of the receipt photo (decision 14.2). */
  devicePrecheck?: DevicePrecheck;
}

interface OccurrenceInput {
  deliveryId: string;
  recipientName: string;
  occurrenceTypeId: string;
  description?: string;
  photo?: UploadFile | null;
  submissionId?: string;

  /**
   * The type as the screen showed it: its form, checked here again before
   * anything is queued, and its version, sent in every report (decision
   * 6.2, contract §7). Absent = no form, version 1.
   */
  occurrenceType?: {
    name: string;
    requires_authorization?: boolean;
    form_fields?: unknown;
    form_version?: number;
  } | null;

  /** The form's answers as typed, by field key. */
  answers?: DraftAnswers;

  /**
   * A refusal, for the screen to act on besides the toast: a form that
   * changed since it was cached is reopened with the answers kept.
   */
  onRefused?: (error: unknown) => void;
}

/**
 * When the driver acted, for the API's `occurred_at`.
 *
 * Read at the tap and frozen into the body, because the body is what the
 * outbox keeps: a proof signed at 10:05 in a dead zone and sent at 13:40 must
 * still say 10:05 (MOB-08). The phone's clock may be wrong; the send path adds
 * `X-Client-Sent-At` from the same clock, and the API uses the difference.
 */
const tappedAt = () => ({ occurred_at: new Date().toISOString() });

/**
 * The phone and the receipt photo's instant (proof design §7.2, §8): in the
 * body recorded at the tap, so a proof sent hours later still names the
 * capture. Each one only when known.
 */
async function proofOrigin(
  receipt: UploadFile | null,
  occurredAt: string,
): Promise<{ device_id?: string; photo_taken_at?: string }> {
  const deviceId = await deviceIdentity().catch(() => null);
  const photoTakenAt = photoTakenAtFor(receipt?.takenAt, occurredAt);

  return {
    ...(deviceId && { device_id: deviceId }),
    ...(photoTakenAt && { photo_taken_at: photoTakenAt }),
  };
}

/**
 * The body as the API will read it, or the reason it would refuse it.
 *
 * Parsed BEFORE `submitOrQueue`: a 400 on a queued item is a permanent
 * failure the driver can only discard, so what the API would refuse must
 * never reach the queue (DLV-ST-2, DLVP-OCC-2). The parsed value is what is
 * sent — normalized, with empty optionals dropped.
 */
function validBody<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  body: unknown,
): T {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  // An empty optional is left out, as the body always did, rather than kept
  // as an `undefined` key in what the queue stores.
  return Object.fromEntries(
    Object.entries(parsed.data as Record<string, unknown>).filter(
      ([, value]) => value !== undefined,
    ),
  ) as T;
}

// After a forced logout the item waits for this driver to sign in again, not
// for a connection, and the detail line says which (MOB-07).
const queuedToast = (title: string, outcome: QueuedOutcome) =>
  Toast.show({
    type: "info",
    text1: title,
    text2: queuedNotice(outcome),
    position: "top",
    visibilityTime: outcome === "queued" ? 4000 : 6000,
  });

const sentToast = (title: string, body: string, onPress?: () => void) => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
    () => undefined,
  );

  Toast.show({
    type: "success",
    text1: title,
    text2: body,
    position: "top",
    // Longer when it offers something to tap.
    visibilityTime: onPress ? 6000 : 3000,
    ...(onPress && { onPress }),
  });
};

/**
 * "Falar com a central sobre isto" (tickets design §8.4): the chat on the
 * ticket the report opened, or on the delivery when the answer named none
 * (the API resolves the delivery to the occurrence's open ticket). The
 * router loads on the tap: this hook stays free of navigation otherwise.
 */
const openChatAbout = (
  delivery: { id: string; recipient: string },
  ticket: { id: string; number: number } | undefined,
): void => {
  Toast.hide();

  void import("expo-router")
    .then(({ router }) =>
      router.navigate({
        pathname: "/chat",
        params: chatContextParams({
          delivery,
          route: null,
          ticket: ticket ? { id: ticket.id, number: ticket.number, subject: null } : null,
        }),
      }),
    )
    .catch(() => undefined);
};

/**
 * Every driver action funnels through submitOrQueue: sent when the network
 * allows, queued in the outbox when it does not — and each one carries a
 * client_submission_id the API anchors in the database, so a resend after
 * a dead network is a no-op instead of a duplicate.
 */
function useDeliveryActions(businessId: string) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [uploadProgress, setUploadProgress] = useState<{
    uploaded: number;
    total: number;
  } | null>(null);

  const listKey = ["my-deliveries", businessId];

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: listKey }).catch(() => undefined);

  // Same shape as queuedToast/sentToast above: short title, detail underneath.
  // The API's refusals carry the part the driver has to act on ("fale com o
  // despachante"), and the default toast ellipsises text1 at ONE line — around
  // forty characters — so putting the whole message there dropped exactly the
  // half that says what to do. The title is the action that failed, which the
  // caller already names, and the detail gets the two lines of text2.
  const showError = (error: unknown, fallback: string) =>
    Toast.show({
      type: "error",
      text1: fallback,
      text2: error instanceof Error ? error.message : undefined,
      position: "top",
      visibilityTime: 6000,
    });

  /**
   * The departure of ONE route — the one the driver pressed.
   *
   * Each assignment creates its own route, so the list can hold a route on
   * the street and a new one released after it. The target comes from the
   * section the button belongs to, never from "the first route found": that
   * posted to the running route, the API answered the resend as success, and
   * the new deliveries stayed designated (MOB-04).
   *
   * `routeId: null` is the whole-day departure of work assigned before
   * assignments created routes. For it the old endpoint is still the only
   * thing that moves anything, and taking it away would strand whatever was
   * dispatched the day the API was deployed.
   */
  const startRoute = async (target: StartRouteTarget): Promise<boolean> => {
    setIsSubmitting(true);

    try {
      const outcome = await submitOrQueue({
        submissionId: randomUUID(),
        kind: "delivery-start-route",
        endpoint: target.routeId
          ? `/route/start-route/${target.routeId}/business/${businessId}`
          : `/delivery/start-route/${businessId}`,
        // The tap becomes the route's started_at when the departure was
        // queued offline. The old endpoint never starts a route: it uses the
        // tap to move only the loose deliveries that existed when it was
        // made, and one past the offline horizon moves nothing (MOB-08). The
        // queue's expiry (isSendExpired) still bounds a stale replay on both.
        body: tappedAt(),
        businessId,
        vehicleLabel:
          target.routeCode !== null
            ? `Início da rota ${target.routeCode}`
            : "Início de rota",
        entries: [],
        uploadType: "deliveryPhotos",
        photoField: "photo",
      });

      if (outcome === "sent") {
        void invalidateList();
        sentToast(
          target.routeCode !== null
            ? `Rota ${target.routeCode} iniciada!`
            : "Rota iniciada!",
          "As entregas designadas estão em rota.",
        );
      } else {
        queuedToast("Início de rota salvo no aparelho", outcome);
      }

      return true;
    } catch (error) {
      showError(error, "Não foi possível iniciar a rota.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const registerArrival = async (
    deliveryId: string,
    recipientName: string,
  ): Promise<boolean> => {
    setIsSubmitting(true);

    try {
      // Before the GPS fix, which can take seconds: the arrival is the tap.
      const when = tappedAt();

      // Required — the arrival IS a place — but bounded: in a basement the
      // fresh fix gives way to the last known one instead of spinning (MOB-13).
      const coordinates = await captureLocation({
        required: true,
        messages: {
          denied: "Ative a permissão de localização para registrar a chegada.",
          unavailable:
            "Não foi possível obter sua localização. Confira se a localização do aparelho está ativada e tente de novo em um local aberto.",
        },
      });

      const submissionId = randomUUID();

      const body = validBody(deliveryArrivalBodySchema, {
        client_submission_id: submissionId,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
        ...when,
      });

      const outcome = await submitOrQueue({
        submissionId,
        kind: "delivery-arrival",
        endpoint: `/delivery/arrival/${deliveryId}/business/${businessId}`,
        body,
        businessId,
        vehicleLabel: `Entrega para ${recipientName}`,
        entries: [],
        uploadType: "deliveryPhotos",
        photoField: "photo",
      });

      // Marked on the cached list at once, sent or queued: until the refetch
      // lands, the stale stop would offer "Cheguei" for a second tap (MOB-19).
      queryClient.setQueryData<MyDeliveriesResponse>(listKey, (cached) =>
        cached
          ? {
              ...cached,
              data: withStopArrived(cached.data, deliveryId, when.occurred_at),
            }
          : cached,
      );

      if (outcome === "sent") {
        void invalidateList();
        sentToast("Chegada registrada!", "O gestor já pode ver o marco.");
      } else {
        queuedToast("Chegada salva no aparelho", outcome);
      }

      return true;
    } catch (error) {
      showError(error, "Não foi possível registrar a chegada.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitProof = async ({
    deliveryId,
    recipientName,
    photo,
    signature,
    receivedBy,
    submissionId: draftSubmissionId,
    devicePrecheck,
  }: ProofInput): Promise<boolean> => {
    setIsSubmitting(true);
    setUploadProgress({ uploaded: 0, total: signature ? 2 : 1 });

    // The mark a new proof puts on the warning about the photo it replaces.
    let proofMark: Promise<(() => void) | undefined> | null = null;

    try {
      const when = tappedAt();

      // The warning about the photo this one replaces stops showing
      // (decision 6.9), sent or queued alike. Marked at the tap, before the
      // send: a warning about THIS photo can land while it is in flight.
      proofMark = markDeliveryProofSubmitted(
        deliveryId,
        Date.parse(when.occurred_at),
      ).catch(() => undefined);

      // Optional: a bonus on the proof, never a reason to hold it back.
      const coordinates = await captureLocation({ required: false });
      const submissionId = draftSubmissionId ?? randomUUID();

      const body = validBody(deliveryProofBodySchema, {
        client_submission_id: submissionId,
        ...when,
        ...(await proofOrigin(photo, when.occurred_at)),
        received_by: normalizeSingleLineText(receivedBy ?? ""),
        ...(coordinates && {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        }),
        // A hint that travels with the proof, frozen with it in the queue.
        ...(devicePrecheck && { device_precheck: devicePrecheck }),
      });

      const outcome = await submitOrQueue({
        submissionId,
        kind: "delivery-proof",
        endpoint: `/delivery/proof/${deliveryId}/business/${businessId}`,
        body,
        businessId,
        vehicleLabel: `Entrega para ${recipientName}`,
        entries: [
          { file: photo, fieldName: "photo" },
          ...(signature ? [{ file: signature, fieldName: "signature" }] : []),
        ],
        uploadType: "deliveryPhotos",
        photoField: "proof",
        onProgress: (uploaded, total) => setUploadProgress({ uploaded, total }),
      });

      if (outcome === "sent") {
        void invalidateList();
        sentToast("Entrega comprovada!", "Canhoto e assinatura registrados.");
      } else {
        queuedToast("Comprovação salva no aparelho", outcome);
      }

      return true;
    } catch (error) {
      // Refused on its merits: the old photo stands, and so does its warning.
      void proofMark?.then((undo) => undo?.());

      showError(error, "Não foi possível comprovar a entrega.");
      return false;
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  const submitDelivered = async ({
    deliveryId,
    recipientName,
    type,
    receiptPhoto,
    signature,
    photos,
    receivedBy,
    description,
    answers,
    submissionId: draftSubmissionId,
    devicePrecheck,
  }: DeliveredInput): Promise<boolean> => {
    const files = deliveredFiles({ receiptPhoto, signature, photos });

    setIsSubmitting(true);
    setUploadProgress(files.length > 0 ? { uploaded: 0, total: files.length } : null);

    // The mark a new receipt puts on the warning about the one it replaces.
    let proofMark: Promise<(() => void) | undefined> | null = null;

    try {
      // What the API would refuse never reaches the queue (a 400 there is a
      // failure the driver can only discard).
      const [missing] = deliveredMissing(type, {
        receiptPhoto: receiptPhoto !== null,
        signature: signature !== null,
        photos: photos.length,
      });

      if (missing) throw new Error(missing.message);

      const when = tappedAt();

      if (receiptPhoto) {
        proofMark = markDeliveryProofSubmitted(
          deliveryId,
          Date.parse(when.occurred_at),
        ).catch(() => undefined);
      }

      const coordinates = await captureLocation({ required: false });
      const submissionId = draftSubmissionId ?? randomUUID();

      // The form first, with its own error (the screen marks each field).
      const formPart = occurrenceFormPart(typeFormOf(type), answers ?? {});

      const body = validBody(deliveredOccurrenceBodySchema, {
        client_submission_id: submissionId,
        occurrenceTypeId: type.id,
        ...when,
        ...(await proofOrigin(receiptPhoto, when.occurred_at)),
        description: description ?? "",
        received_by: normalizeSingleLineText(receivedBy ?? ""),
        ...(coordinates && {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        }),
        ...formPart,
        // Only with the receipt it read (decision 14.2).
        ...(devicePrecheck && receiptPhoto && { device_precheck: devicePrecheck }),
      });

      let status: string | null = null;

      const outcome = await submitOrQueue({
        submissionId,
        kind: DELIVERED_KIND,
        endpoint: `/delivery/report-occurrence/${deliveryId}/business/${businessId}`,
        body,
        businessId,
        vehicleLabel: `Entrega para ${recipientName}`,
        entries: files,
        uploadType: "deliveryPhotos",
        photoField: "occurrence-files",
        onProgress: (uploaded, total) => setUploadProgress({ uploaded, total }),
        onSent: (response) => {
          const report = sentReportOf(response);
          status = report.status;

          // A type that asks the tower waits on the stop, like a request.
          queryClient.setQueryData<MyDeliveriesResponse>(listKey, (cached) =>
            withSentReport(cached, {
              deliveryId,
              occurrenceTypeId: type.id,
              occurrenceTypeName: type.name,
              requestedAt: new Date().toISOString(),
              report,
            }),
          );
        },
      });

      if (outcome === "sent") {
        void invalidateList();

        const notice = deliveredSentNotice(status);
        sentToast(notice.title, notice.message);
      } else {
        queuedToast(
          type.requires_authorization
            ? "Entrega salva no aparelho (aguarda a torre)"
            : "Comprovação salva no aparelho",
          outcome,
        );
      }

      return true;
    } catch (error) {
      void proofMark?.then((undo) => undo?.());

      showError(error, "Não foi possível registrar a entrega.");
      return false;
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  const reportOccurrence = async ({
    deliveryId,
    recipientName,
    occurrenceTypeId,
    description,
    photo,
    submissionId: draftSubmissionId,
    occurrenceType,
    answers,
    onRefused,
  }: OccurrenceInput): Promise<boolean> => {
    setIsSubmitting(true);

    try {
      const when = tappedAt();
      const coordinates = await captureLocation({ required: false });
      const submissionId = draftSubmissionId ?? randomUUID();

      // The form (decision 6.2) is checked with the API's own rules before
      // the queue: an answer the API would refuse is a failure the driver
      // could only discard hours later.
      const body = buildOccurrenceBody({
        submissionId,
        occurrenceTypeId,
        occurredAt: when.occurred_at,
        description,
        coordinates,
        form: typeFormOf(occurrenceType),
        answers: answers ?? {},
      });

      let sent: SentReport | null = null;

      const outcome = await submitOrQueue({
        submissionId,
        kind: "delivery-occurrence",
        endpoint: `/delivery/report-occurrence/${deliveryId}/business/${businessId}`,
        body,
        businessId,
        vehicleLabel: `Entrega para ${recipientName}`,
        entries: photo ? [{ file: photo }] : [],
        uploadType: "deliveryPhotos",
        photoField: "photo-keys",
        onProgress: (uploaded, total) => setUploadProgress({ uploaded, total }),
        onSent: (response) => {
          const report = sentReportOf(response);
          sent = report;

          // "Aguardando autorização da torre" on the stop at once, before
          // the refetch (decision 6.3) — and kept if the refetch never lands.
          // The queue's later send does the same (kind-effects).
          queryClient.setQueryData<MyDeliveriesResponse>(listKey, (cached) =>
            withSentReport(cached, {
              deliveryId,
              occurrenceTypeId,
              occurrenceTypeName: occurrenceType?.name,
              // The 201's instant, as the server dates the request.
              requestedAt: new Date().toISOString(),
              report,
            }),
          );
        },
      });

      if (outcome === "sent") {
        void invalidateList();

        const report = sent as SentReport | null;
        const notice = sentReportNotice(report?.status ?? "NOT_REQUIRED");

        // The default toast shows one line of text2, already taken by the
        // notice: the tap is the shortcut, as the tickets design asks.
        sentToast(notice.title, notice.message, () =>
          openChatAbout({ id: deliveryId, recipient: recipientName }, report?.ticket),
        );
      } else {
        queuedToast(
          occurrenceType?.requires_authorization
            ? "Pedido de autorização salvo no aparelho"
            : "Ocorrência salva no aparelho",
          outcome,
        );
      }

      return true;
    } catch (error) {
      onRefused?.(error);
      showError(error, "Não foi possível registrar a ocorrência.");
      return false;
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  };

  return {
    isSubmitting,
    uploadProgress,
    startRoute,
    registerArrival,
    submitProof,
    submitDelivered,
    reportOccurrence,
  };
}

export { useDeliveryActions };
export type { DeliveredInput, OccurrenceInput, ProofInput };
