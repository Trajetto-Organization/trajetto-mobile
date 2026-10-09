import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "@/store/auth-store";

import {
  proofFeedbackGuidance,
  proofFeedbackProblems,
  proofFeedbackStep,
  visibleProofFeedback,
  type ProofFeedbackStep,
  type StoredProofFeedback,
} from "./proof-feedback-rules";
import {
  hydrateProofFeedbackStore,
  proofFeedbackScope,
  scopedProofFeedback,
  useProofFeedbackStore,
} from "./proof-feedback-store";

interface DeliveryProofFeedback {
  feedback: StoredProofFeedback;

  /** One line per problem, or empty when the message is shown whole. */
  problems: string[];

  step: ProofFeedbackStep;
  guidance: string;
}

/**
 * The warning the automatic reading raised about this delivery's proof, as
 * the delivery shows it (decision 6.9), or `null`.
 *
 * `delivery` is the row of the working list, or `null` once it left the list
 * (proven): together with when the list was last fetched, it is what tells a
 * delivery reopened by the office from a list that predates the proof.
 */
function useProofFeedback(
  deliveryId: string,
  delivery: { status: string } | null,
): DeliveryProofFeedback | null {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  const scope =
    user?.id && user.businessId
      ? proofFeedbackScope(user.id, user.businessId)
      : null;

  useEffect(() => {
    void hydrateProofFeedbackStore();
  }, []);

  // The stored entry itself (a stable reference), not a copy: a new object
  // per read would re-render the screen on every store change.
  const feedback = useProofFeedbackStore((state) =>
    scope && deliveryId
      ? visibleProofFeedback(scopedProofFeedback(state, scope), deliveryId)
      : null,
  );

  if (!feedback) return null;

  const listUpdatedAt =
    queryClient.getQueryState(["my-deliveries", user?.businessId ?? ""])
      ?.dataUpdatedAt ?? 0;

  const step = proofFeedbackStep({
    receivedAt: feedback.receivedAt,
    delivery,
    listUpdatedAt,
  });

  return {
    feedback,
    problems: proofFeedbackProblems(feedback.message),
    step,
    guidance: proofFeedbackGuidance(step),
  };
}

export { useProofFeedback };
export type { DeliveryProofFeedback };
