import { randomUUID } from "expo-crypto";

import { captureLocation } from "@/features/tracking/capture-location";
import { submitOrQueue } from "@/features/submissions/submit-or-queue";
import { afterSubmissionSent } from "@/features/submissions/kind-effects";
import type { QueuedOutcome } from "@/features/submissions/queue-decision";

import { queryClient } from "@/providers/query-provider";
import { ApiError } from "@/utils/api";

import { ON_THE_WAY_KIND, onTheWayEndpoint } from "./on-the-way-rules";
import { onTheWayBodySchema } from "./on-the-way-schema";

/**
 * "Estou a caminho" for one stop, outside React so a test can drive it.
 *
 * One tap: no confirmation, the position only if the phone has one within a
 * short budget, and an idempotency key made once here — a resend from the
 * queue is the same mark to the API, never a second customer message.
 */

interface OnTheWayTarget {
  deliveryId: string;
  stopId: string;
  routeId: string;
  recipientName: string;
}

type MarkOnTheWayResult =
  | { status: "sent" | QueuedOutcome }
  /** The stop or the route moved on: nothing to mark, nothing lost. */
  | { status: "moot"; message: string }
  | { status: "refused"; message: string };

const MOOT_CODES = new Set(["ROUTE_STOP_NOT_PENDING", "ROUTE_NOT_IN_PROGRESS"]);

async function markStopOnTheWay(
  context: { userId: string; businessId: string },
  target: OnTheWayTarget,
): Promise<MarkOnTheWayResult> {
  // The tap, frozen before the GPS: the queue may send it hours later.
  const occurredAt = new Date().toISOString();

  try {
    const coordinates = await captureLocation({ required: false });
    const submissionId = randomUUID();

    const parsed = onTheWayBodySchema.safeParse({
      client_submission_id: submissionId,
      occurred_at: occurredAt,
      ...(coordinates && {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      }),
    });

    if (!parsed.success) {
      return {
        status: "refused",
        message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      };
    }

    const body: Record<string, unknown> = { ...parsed.data };
    const endpoint = onTheWayEndpoint(target.stopId, target.routeId, context.businessId);

    const status = await submitOrQueue({
      submissionId,
      kind: ON_THE_WAY_KIND,
      endpoint,
      body,
      businessId: context.businessId,
      vehicleLabel: `Entrega para ${target.recipientName}`,
      entries: [],
      uploadType: "deliveryPhotos",
      photoField: "photo",
      onSent: (response) =>
        afterSubmissionSent(
          {
            kind: ON_THE_WAY_KIND,
            businessId: context.businessId,
            ownerUserId: context.userId,
            endpoint,
            body,
          },
          response,
        ),
    });

    return { status };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Não foi possível avisar que está a caminho.";

    if (error instanceof ApiError && error.code && MOOT_CODES.has(error.code)) {
      // The cached stop is behind the server's: the list reads it again.
      void queryClient
        .invalidateQueries({ queryKey: ["my-deliveries", context.businessId] })
        .catch(() => undefined);

      return { status: "moot", message };
    }

    return { status: "refused", message };
  }
}

export { markStopOnTheWay };
export type { MarkOnTheWayResult, OnTheWayTarget };
