import { useEffect, useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Toast from "react-native-toast-message";

import { hasDeliveriesAccess } from "@/features/access/module-rules";
import { queuedNotice } from "@/features/submissions/queue-decision";

import { useAuthStore } from "@/store/auth-store";
import { useOutboxStore } from "@/store/outbox-store";
import { apiClient } from "@/utils/api";

import {
  PAUSE_QUEUED_BEHIND_NOTICE,
  PAUSE_REQUIRES_ROUTE_NOTICE,
  canStartPause,
  currentPauseFromResponse,
  formatPauseDuration,
  isStartQueued,
  pauseScope,
  pauseTitle,
  queuedPauseItems,
  resolvePause,
  shouldAdoptServer,
  type OpenPause,
  type PauseKind,
  type ServerPauseSnapshot,
} from "./pause-rules";
import { endDriverPause, recoverPauseHandoffs, startDriverPause } from "./pause-actions";
import { hydratePauseStore, usePauseStore } from "./pause-store";
import { onPauseRequiresRoute } from "./pause-notices";

/** A quick switch to another app does not reread; a real absence does. */
const CURRENT_PAUSE_STALE_MS = 30_000;

const success = (text1: string, text2: string) => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);

  Toast.show({ type: "success", text1, text2, position: "top", visibilityTime: 3000 });
};

const info = (text1: string, text2: string, long = false) =>
  Toast.show({ type: "info", text1, text2, position: "top", visibilityTime: long ? 6000 : 4000 });

const failure = (text1: string, text2?: string) =>
  Toast.show({ type: "error", text1, text2, position: "top", visibilityTime: 6000 });

/**
 * The driver's pause for the deliveries screen (decision 6.1): whether one is
 * open, since when, and the two gestures.
 *
 * Only for a driver of a company with Entregas (the API's gate: driver
 * session, `delivery_manage:write`, module DELIVERIES). The server's
 * `/current` is read on mount, on return to the app and after login; the
 * phone's record wins while a gesture of the driver's is in flight or queued.
 */
function useDriverPause() {
  const user = useAuthStore((state) => state.user);

  const userId = user?.id ?? "";
  const businessId = user?.businessId ?? "";
  const enabled = hasDeliveriesAccess(user) && Boolean(userId) && Boolean(businessId);
  const scope = pauseScope(userId, businessId);

  const [ready, setReady] = useState<boolean>(() => usePauseStore.persist.hasHydrated());

  useEffect(() => {
    if (ready) return;

    let active = true;
    void hydratePauseStore().then(() => {
      if (active) setReady(true);
    });

    return () => {
      active = false;
    };
  }, [ready]);

  // Decision 14.4: a queued pause the API refused outside a journey left the
  // phone silently (kind-effects); the driver is told why it is gone.
  useEffect(() => {
    if (!enabled) return;

    return onPauseRequiresRoute(() =>
      info("Pausa não registrada", PAUSE_REQUIRES_ROUTE_NOTICE, true),
    );
  }, [enabled]);

  // A gesture left on disk mid-handoff by a killed app goes to the queue as
  // soon as this driver's screen is up (and before any new gesture).
  useEffect(() => {
    if (!enabled) return;

    void recoverPauseHandoffs(userId);
  }, [enabled, userId]);

  const local = usePauseStore((state) => state.byScope[scope] ?? null);
  const sending = usePauseStore((state) => state.sending[scope] === true);

  // Being handed over, here or by a process that died doing it: the server
  // cannot know it yet either way (resolvePause).
  const handingOver = usePauseStore(
    (state) => state.sending[scope] === true || state.handoffs[scope] !== undefined,
  );

  const items = useOutboxStore((state) => state.items);
  const queued = useMemo(
    () => queuedPauseItems(items, { ownerUserId: userId, businessId }),
    [items, userId, businessId],
  );

  const query = useQuery({
    queryKey: ["driver-pause", businessId, "current"],
    enabled,
    staleTime: CURRENT_PAUSE_STALE_MS,
    queryFn: async (): Promise<ServerPauseSnapshot> => {
      // When it was ASKED: an answer that left before a tap describes the
      // world before it (resolvePause).
      const requestedAt = Date.now();
      const response = await apiClient.request<unknown>(
        `/driver-pause/current/${businessId}`,
      );

      const open = currentPauseFromResponse(response);

      if (open === undefined) {
        throw new Error("Resposta inesperada ao ler a pausa em andamento.");
      }

      return { open, requestedAt };
    },
  });

  const server = enabled ? (query.data ?? null) : null;

  const resolved = useMemo(
    () => resolvePause({ local, server, queued, sending: handingOver }),
    [local, server, queued, handingOver],
  );

  // What the server said becomes the phone's record, so a cold start with no
  // signal shows it (a pause ended or started on another install).
  useEffect(() => {
    if (!ready || !enabled || !server) return;

    if (shouldAdoptServer({ local, server, queued, sending: handingOver })) {
      usePauseStore.getState().adopt(scope, server.open, server.requestedAt);
    }
  }, [ready, enabled, local, server, queued, handingOver, scope]);

  const open = enabled && ready ? resolved.open : null;
  const canStart = enabled && ready && canStartPause(resolved);
  const context = { userId, businessId };

  const start = async (
    kind: PauseKind,
    note?: string | null,
    // Decision 14.4: the company's pause type chosen (null = the nature alone).
    type?: { occurrenceTypeId: string | null; label: string } | null,
  ): Promise<boolean> => {
    if (!canStart) {
      failure("Já existe uma pausa em andamento.", "Encerre-a antes de iniciar outra.");
      return false;
    }

    const result = await startDriverPause(context, {
      kind,
      note,
      occurrenceTypeId: type?.occurrenceTypeId ?? null,
      typeName: type?.occurrenceTypeId ? type.label : null,
    });

    const title = type?.occurrenceTypeId ? `Pausa: ${type.label}` : pauseTitle(kind);

    switch (result.status) {
      case "sent":
        success(`${title} iniciada`, "O tempo de pausa já está contando.");
        return true;

      case "queued-behind":
        info(`${title} iniciada no aparelho`, PAUSE_QUEUED_BEHIND_NOTICE);
        return true;

      case "queued":
      case "queued-signed-out":
      case "queued-until-update":
        info(
          `${title} iniciada no aparelho`,
          queuedNotice(result.status),
          result.status !== "queued",
        );
        return true;

      case "already-open":
        failure(
          "Já existe uma pausa em andamento.",
          "Ela foi iniciada em outro acesso e aparece aqui em instantes.",
        );
        return false;

      case "busy":
        return false;

      case "refused":
        failure("Não foi possível iniciar a pausa.", result.message);
        return false;
    }
  };

  const end = async (pause: OpenPause): Promise<boolean> => {
    const endedAt = Date.now();
    const result = await endDriverPause(context, pause);
    const lasted = `Duração: ${formatPauseDuration(pause.startedAt, endedAt)}.`;

    switch (result.status) {
      case "sent":
        success("Pausa encerrada", lasted);
        return true;

      case "queued-behind":
        info("Pausa encerrada no aparelho", `${lasted} ${PAUSE_QUEUED_BEHIND_NOTICE}`);
        return true;

      case "queued":
      case "queued-signed-out":
      case "queued-until-update":
        info(
          "Pausa encerrada no aparelho",
          `${lasted} ${queuedNotice(result.status)}`,
          result.status !== "queued",
        );
        return true;

      case "already-ended":
        info("Esta pausa já estava encerrada", "A tela foi atualizada.");
        return true;

      case "busy":
        return false;

      case "refused":
        failure("Não foi possível encerrar a pausa.", result.message);
        return false;
    }
  };

  return {
    /** The control exists at all: a driver with Entregas, record loaded. */
    enabled: enabled && ready,

    open,

    /** "Iniciar pausa" may be offered: one open pause at a time. */
    canStart,

    /** The open pause's start is still only on this phone. */
    startQueued: isStartQueued(open, queued),

    isSending: sending,
    start,
    end,
  };
}

type DriverPauseControl = ReturnType<typeof useDriverPause>;

export { useDriverPause };
export type { DriverPauseControl };
