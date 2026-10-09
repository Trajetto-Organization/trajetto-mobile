import { randomUUID } from "expo-crypto";

import { captureLocation } from "@/features/tracking/capture-location";
import {
  enqueueSubmission,
  processOutbox,
} from "@/features/submissions/outbox";
import { submitOrQueue } from "@/features/submissions/submit-or-queue";
import { afterSubmissionSent } from "@/features/submissions/kind-effects";
import type { QueuedOutcome } from "@/features/submissions/queue-decision";

import { queryClient } from "@/providers/query-provider";
import { useOutboxStore } from "@/store/outbox-store";
import { ApiError } from "@/utils/api";

import {
  PAUSE_END_KIND,
  PAUSE_START_KIND,
  endPauseBody,
  mustQueueBehind,
  pauseScope,
  pauseTitle,
  queuedPauseItems,
  startPauseBody,
  type OpenPause,
  type PauseHandoff,
  type PauseKind,
} from "./pause-rules";
import {
  endPauseBodySchema,
  parsePauseBody,
  startPauseBodySchema,
} from "./pause-schemas";
import {
  hydratePauseStore,
  returnLeftoverHandoff,
  takeLeftoverHandoffs,
  usePauseStore,
} from "./pause-store";

/**
 * The two pause gestures, outside React so a test can drive them.
 *
 * Offline-first like every driver action: the phone records the gesture
 * first (the banner is the driver's, with or without signal), then sends it
 * or queues it with an idempotency key made once at the tap. A refusal at the
 * tap takes the record back, since nothing was stored anywhere.
 *
 * Between the tap and the queue the gesture waits for the GPS and for the
 * API; it is on disk as a handoff all that time, so an app killed in between
 * loses nothing (`recoverPauseHandoffs`).
 */

interface PauseContext {
  userId: string;
  businessId: string;
}

/**
 * "queued-behind": queued only to keep the order of the pause gestures (an
 * older one still waits), not for want of a connection.
 */
type PauseSendOutcome = "sent" | QueuedOutcome | "queued-behind";

type StartPauseResult =
  | { status: PauseSendOutcome; pause: OpenPause }
  /** Another gesture of this driver is being sent right now. */
  | { status: "busy" }
  /** The server has another pause open (another install): shown instead. */
  | { status: "already-open" }
  | { status: "refused"; message: string };

type EndPauseResult =
  | { status: PauseSendOutcome }
  | { status: "busy" }
  /** Ended already, or never recorded (too old): nothing left to end. */
  | { status: "already-ended" }
  | { status: "refused"; message: string };

// Never awaited: nothing on screen waits for the reread (the record is
// already settled), and a weak link can take the request's whole timeout.
const refreshPause = (businessId: string): void => {
  void queryClient
    .invalidateQueries({ queryKey: ["driver-pause", businessId] })
    .catch(() => undefined);
};

const enqueueHandoff = (handoff: PauseHandoff) =>
  enqueueSubmission({
    id: handoff.submissionId,
    kind: handoff.kind,
    businessId: handoff.businessId,
    ownerUserId: handoff.ownerUserId,
    vehicleLabel: handoff.vehicleLabel,
    endpoint: handoff.endpoint,
    body: handoff.body,
    uploadType: "deliveryPhotos",
    photoField: "photo",
    photos: [],
  });

let recovery: Promise<void> = Promise.resolve();

/**
 * Queues the gestures a killed app left mid-handoff: tapped and recorded,
 * never sent nor queued. Serialised, and awaited by every gesture, so a new
 * tap is ordered behind what it recovers (`mustQueueBehind`).
 */
function recoverPauseHandoffs(userId: string): Promise<void> {
  recovery = recovery
    .then(async () => {
      await hydratePauseStore();

      let recovered = 0;

      for (const { scope, handoff } of takeLeftoverHandoffs(userId)) {
        try {
          // Same key as at the tap: if it did land before the kill, the API
          // only replays it.
          await enqueueHandoff(handoff);
          usePauseStore.getState().endHandoff(scope, handoff.submissionId);
          recovered += 1;
        } catch {
          returnLeftoverHandoff(scope, handoff);
        }
      }

      if (recovered > 0) void processOutbox();
    })
    .catch(() => undefined);

  return recovery;
}

/**
 * Sends the gesture now, or puts it behind the pause gestures already
 * waiting: they go in the order they were tapped (`mustQueueBehind`).
 */
async function sendOrQueue(
  handoff: PauseHandoff,
  context: PauseContext,
): Promise<PauseSendOutcome> {
  const waiting = queuedPauseItems(useOutboxStore.getState().items, {
    ownerUserId: context.userId,
    businessId: context.businessId,
  });

  if (mustQueueBehind(waiting)) {
    await enqueueHandoff(handoff);
    void processOutbox();

    return "queued-behind";
  }

  return submitOrQueue({
    submissionId: handoff.submissionId,
    kind: handoff.kind,
    endpoint: handoff.endpoint,
    body: handoff.body,
    businessId: handoff.businessId,
    vehicleLabel: handoff.vehicleLabel,
    entries: [],
    uploadType: "deliveryPhotos",
    photoField: "photo",
    onSent: (response) =>
      afterSubmissionSent(
        {
          kind: handoff.kind,
          businessId: handoff.businessId,
          ownerUserId: handoff.ownerUserId,
          endpoint: handoff.endpoint,
          body: handoff.body,
        },
        response,
      ),
  });
}

const codeOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.code : undefined;

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : "Não foi possível registrar a pausa.";

/** "Iniciar pausa": one open pause at a time, checked by the caller's view. */
async function startDriverPause(
  context: PauseContext,
  input: {
    kind: PauseKind;
    note?: string | null;
    /** Decision 14.4: the company's pause type chosen, and its name. */
    occurrenceTypeId?: string | null;
    typeName?: string | null;
  },
): Promise<StartPauseResult> {
  await recoverPauseHandoffs(context.userId);

  const scope = pauseScope(context.userId, context.businessId);
  const store = usePauseStore.getState();

  if (store.sending[scope]) return { status: "busy" };

  const startSubmissionId = randomUUID();
  const occurredAt = new Date().toISOString();

  let body: Record<string, unknown>;

  try {
    // Parsed before anything is recorded: a note the API would refuse never
    // shows a pause, and never enters the queue.
    body = parsePauseBody(
      startPauseBodySchema,
      startPauseBody({
        startSubmissionId,
        kind: input.kind,
        occurrenceTypeId: input.occurrenceTypeId,
        occurredAt,
        note: input.note,
      }),
    );
  } catch (error) {
    return { status: "refused", message: messageOf(error) };
  }

  const pause: OpenPause = {
    startSubmissionId,
    kind: input.kind,
    occurrenceTypeId: input.occurrenceTypeId ?? null,
    typeName: input.typeName ?? null,
    startedAt: occurredAt,
    note: typeof body.note === "string" ? body.note : null,
    latitude: null,
    longitude: null,
  };

  let handoff: PauseHandoff = {
    submissionId: startSubmissionId,
    kind: PAUSE_START_KIND,
    businessId: context.businessId,
    ownerUserId: context.userId,
    endpoint: `/driver-pause/start/${context.businessId}`,
    body,
    vehicleLabel: input.typeName ? `Pausa: ${input.typeName}` : pauseTitle(input.kind),
  };

  // On disk before the send (contract), with what the queue needs to send
  // it: the timer runs from the tap even if the app dies in the next second.
  store.setSending(scope, true);
  store.beginHandoff(scope, pause, handoff);

  try {
    // A bonus for the report, never a reason to hold the pause back.
    const coordinates = await captureLocation({ required: false });

    const located: OpenPause = coordinates
      ? { ...pause, latitude: coordinates.latitude, longitude: coordinates.longitude }
      : pause;

    if (coordinates) {
      handoff = {
        ...handoff,
        body: parsePauseBody(
          startPauseBodySchema,
          startPauseBody({
            startSubmissionId,
            kind: input.kind,
            occurrenceTypeId: input.occurrenceTypeId,
            occurredAt,
            note: pause.note,
            coordinates,
          }),
        ),
      };

      // The end repeats the start as it was sent, position included.
      usePauseStore.getState().beginHandoff(scope, located, handoff);
    }

    const status = await sendOrQueue(handoff, context);

    return { status, pause: located };
  } catch (error) {
    // Refused at the tap: the API stored nothing, so neither does the phone.
    usePauseStore.getState().forgetOpen(scope, startSubmissionId);

    if (codeOf(error) === "PAUSE_ALREADY_OPEN") {
      refreshPause(context.businessId);
      return { status: "already-open" };
    }

    return { status: "refused", message: messageOf(error) };
  } finally {
    const current = usePauseStore.getState();

    // Sent, queued or refused: in every case nothing is left to hand over.
    current.endHandoff(scope, startSubmissionId);
    current.setSending(scope, false);
  }
}

/** "Encerrar pausa", for the pause the screen shows (local or the server's). */
async function endDriverPause(
  context: PauseContext,
  open: OpenPause,
): Promise<EndPauseResult> {
  await recoverPauseHandoffs(context.userId);

  const scope = pauseScope(context.userId, context.businessId);
  const store = usePauseStore.getState();

  if (store.sending[scope]) return { status: "busy" };

  const endSubmissionId = randomUUID();
  const occurredAt = new Date().toISOString();

  const endBody = (coordinates?: { latitude: number; longitude: number } | null) =>
    parsePauseBody(
      endPauseBodySchema,
      endPauseBody(open, { endSubmissionId, occurredAt, coordinates }),
    );

  let handoff: PauseHandoff;

  try {
    handoff = {
      submissionId: endSubmissionId,
      kind: PAUSE_END_KIND,
      businessId: context.businessId,
      ownerUserId: context.userId,
      endpoint: `/driver-pause/end/${context.businessId}`,
      body: endBody(),
      vehicleLabel: pauseTitle(open.kind),
    };
  } catch (error) {
    return { status: "refused", message: messageOf(error) };
  }

  store.setSending(scope, true);

  // Ended on the phone at the tap, like the start: the banner goes now, and
  // the end is on disk with it.
  store.beginHandoff(scope, null, handoff);

  try {
    const coordinates = await captureLocation({ required: false });

    if (coordinates) {
      handoff = { ...handoff, body: endBody(coordinates) };
      usePauseStore.getState().beginHandoff(scope, null, handoff);
    }

    const status = await sendOrQueue(handoff, context);

    return { status };
  } catch (error) {
    const code = codeOf(error);

    // Nothing left to end: another end won, or the pause was never kept.
    if (code === "PAUSE_ALREADY_ENDED" || code === "PAUSE_TOO_OLD") {
      // Settled with the server: an answer asked before this refusal may
      // still show the pause open, and must not bring it back.
      usePauseStore.getState().settle(scope, null);
      refreshPause(context.businessId);
      return { status: "already-ended" };
    }

    // Refused at the tap for another reason: the pause is still open.
    usePauseStore.getState().setOpen(scope, open);

    return { status: "refused", message: messageOf(error) };
  } finally {
    const current = usePauseStore.getState();

    current.endHandoff(scope, endSubmissionId);
    current.setSending(scope, false);
  }
}

export { endDriverPause, recoverPauseHandoffs, startDriverPause };
export type { EndPauseResult, PauseContext, PauseSendOutcome, StartPauseResult };
