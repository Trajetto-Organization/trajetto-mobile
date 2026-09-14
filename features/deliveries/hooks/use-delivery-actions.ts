import { useState } from "react";

import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";

import * as Location from "expo-location";
import Toast from "react-native-toast-message";

import { submitOrQueue } from "@/features/submissions/submit-or-queue";
import { queryClient } from "@/providers/query-provider";

import type { UploadFile } from "@/features/media/upload-to-storage";

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface ProofInput {
  deliveryId: string;
  recipientName: string;
  photo: UploadFile;
  signature?: UploadFile | null;
  receivedBy?: string;
}

interface OccurrenceInput {
  deliveryId: string;
  recipientName: string;
  occurrenceTypeId: string;
  description?: string;
  photo?: UploadFile | null;
}

/**
 * Reads where the driver is. Arrival cannot exist without it (the whole
 * point of the appointment is the place); proof and occurrence take it as
 * a bonus and go on without when the permission is off.
 */
async function captureLocation(required: boolean): Promise<Coordinates | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== "granted") {
      if (required) {
        throw new Error(
          "Ative a permissão de localização para registrar a chegada.",
        );
      }

      return null;
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch (error) {
    if (required) throw error;
    return null;
  }
}

const queuedToast = (title: string) =>
  Toast.show({
    type: "info",
    text1: title,
    text2: "Será enviado automaticamente quando houver conexão.",
    position: "top",
    visibilityTime: 4000,
  });

const sentToast = (title: string, body: string) => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
    () => undefined,
  );

  Toast.show({
    type: "success",
    text1: title,
    text2: body,
    position: "top",
    visibilityTime: 3000,
  });
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

  const invalidateList = () =>
    queryClient
      .invalidateQueries({ queryKey: ["my-deliveries", businessId] })
      .catch(() => undefined);

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

  const startRoute = async (): Promise<boolean> => {
    setIsSubmitting(true);

    try {
      const outcome = await submitOrQueue({
        submissionId: randomUUID(),
        kind: "delivery-start-route",
        endpoint: `/delivery/start-route/${businessId}`,
        body: {},
        businessId,
        vehicleLabel: "Início de rota",
        entries: [],
        uploadType: "deliveryPhotos",
        photoField: "photo",
      });

      if (outcome === "sent") {
        void invalidateList();
        sentToast("Rota iniciada!", "As entregas designadas estão em rota.");
      } else {
        queuedToast("Início de rota salvo no aparelho");
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
      const coordinates = await captureLocation(true);
      const submissionId = randomUUID();

      const outcome = await submitOrQueue({
        submissionId,
        kind: "delivery-arrival",
        endpoint: `/delivery/arrival/${deliveryId}/business/${businessId}`,
        body: {
          client_submission_id: submissionId,
          latitude: coordinates!.latitude,
          longitude: coordinates!.longitude,
        },
        businessId,
        vehicleLabel: `Entrega para ${recipientName}`,
        entries: [],
        uploadType: "deliveryPhotos",
        photoField: "photo",
      });

      if (outcome === "sent") {
        void invalidateList();
        sentToast("Chegada registrada!", "O gestor já pode ver o marco.");
      } else {
        queuedToast("Chegada salva no aparelho");
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
  }: ProofInput): Promise<boolean> => {
    setIsSubmitting(true);
    setUploadProgress({ uploaded: 0, total: signature ? 2 : 1 });

    try {
      const coordinates = await captureLocation(false);
      const submissionId = randomUUID();

      const outcome = await submitOrQueue({
        submissionId,
        kind: "delivery-proof",
        endpoint: `/delivery/proof/${deliveryId}/business/${businessId}`,
        body: {
          client_submission_id: submissionId,
          ...(receivedBy?.trim() && { received_by: receivedBy.trim() }),
          ...(coordinates && {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
          }),
        },
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
        queuedToast("Comprovação salva no aparelho");
      }

      return true;
    } catch (error) {
      showError(error, "Não foi possível comprovar a entrega.");
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
  }: OccurrenceInput): Promise<boolean> => {
    setIsSubmitting(true);

    try {
      const coordinates = await captureLocation(false);
      const submissionId = randomUUID();

      const outcome = await submitOrQueue({
        submissionId,
        kind: "delivery-occurrence",
        endpoint: `/delivery/report-occurrence/${deliveryId}/business/${businessId}`,
        body: {
          client_submission_id: submissionId,
          occurrenceTypeId,
          ...(description?.trim() && { description: description.trim() }),
          ...(coordinates && {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
          }),
        },
        businessId,
        vehicleLabel: `Entrega para ${recipientName}`,
        entries: photo ? [{ file: photo }] : [],
        uploadType: "deliveryPhotos",
        photoField: "photo-keys",
        onProgress: (uploaded, total) => setUploadProgress({ uploaded, total }),
      });

      if (outcome === "sent") {
        void invalidateList();
        sentToast("Ocorrência registrada!", "O gestor foi avisado.");
      } else {
        queuedToast("Ocorrência salva no aparelho");
      }

      return true;
    } catch (error) {
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
    reportOccurrence,
  };
}

export { useDeliveryActions };
export type { OccurrenceInput, ProofInput };
