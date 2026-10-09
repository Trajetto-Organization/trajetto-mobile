/**
 * What signing out leaves behind, said before it happens (MOB-15).
 *
 * Logging out keeps the queue on the phone — it is work the driver already
 * finished — but only the same account ever sends it, on its next login. On a
 * phone shared between shifts that can mean never, and nothing said so: the
 * modal only asked "tem certeza?". Half-filled forms are deleted outright.
 *
 * Pure (it imports only the pure `outbox-rules`), so the wording and the
 * counts are tested without a device.
 */

import { SEND_NOW_INCOMPLETE_MESSAGE } from "./outbox-rules";

/** The prefix every form key shares (`submission-id.createSubmissionStorageKey`). */
const SUBMISSION_KEY_PREFIX = "@trajetto:submission:";
const DRAFT_KEY_SUFFIX = ":draft";

/**
 * How many half-filled forms of this user the logout will delete.
 *
 * Reads the draft keys, `@trajetto:submission:<kind>:<userId>:…:draft`, so a
 * new kind of draft written with the same key shape is counted without a
 * change here. Someone else's drafts are not this user's to be warned about.
 */
function countOpenDrafts(keys: readonly string[], userId: string | null): number {
  if (!userId) return 0;

  return keys.filter((key) => {
    if (!key.startsWith(SUBMISSION_KEY_PREFIX) || !key.endsWith(DRAFT_KEY_SUFFIX)) {
      return false;
    }

    const [, , , owner] = key.split(":");
    return owner === userId;
  }).length;
}

interface LogoutQueueCounts {
  /** Waiting for a connection or a retry. */
  pending: number;

  /** Refused on the merits — needs the driver's decision. */
  failed: number;

  /** Waiting for the company to switch a module back on. */
  parked: number;

  /**
   * Left by an older build that did not record whose they were: they never
   * leave until someone says they are theirs (pending screen).
   */
  unclaimed: number;

  /** Forms being filled, which the logout deletes. */
  drafts: number;
}

interface LogoutWarning {
  /** Anything worth a second thought: changes the title and the button. */
  hasRisk: boolean;

  title: string;
  lines: string[];
  confirmLabel: string;

  /** Something could still go out right now, before signing out. */
  canSendNow: boolean;

  /** There is a list worth opening before deciding. */
  canReviewQueue: boolean;
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

interface LogoutContext {
  isOffline: boolean;

  /**
   * "Enviar agora" ran and some pending items are still here: said, rather
   * than letting the same warning come back as if nothing had happened.
   */
  sendIncomplete?: boolean;

  /**
   * `false` when this session can neither send nor open the pending screen:
   * signing out from the access-denied screen (revoked, inactive driver, no
   * profile). The warning is still said; offering "Enviar agora" there would
   * only turn pending items into refusals, and the pending screen is behind
   * the same denial.
   */
  canActOnQueue?: boolean;
}

function logoutWarning(
  counts: LogoutQueueCounts,
  connection: LogoutContext,
): LogoutWarning {
  const queued = counts.pending + counts.failed + counts.parked;
  const lines: string[] = [];

  if (queued > 0) {
    lines.push(
      queued === 1
        ? "1 envio ainda não chegou à empresa. Ele fica guardado neste aparelho e só será enviado quando você entrar de novo com esta conta."
        : `${queued} envios ainda não chegaram à empresa. Eles ficam guardados neste aparelho e só serão enviados quando você entrar de novo com esta conta.`,
    );
  }

  if (counts.failed > 0) {
    lines.push(
      counts.failed === 1
        ? "1 envio foi recusado e precisa da sua decisão."
        : `${counts.failed} envios foram recusados e precisam da sua decisão.`,
    );
  }

  if (counts.parked > 0) {
    lines.push(
      counts.parked === 1
        ? "1 envio aguarda a empresa reativar um módulo."
        : `${counts.parked} envios aguardam a empresa reativar um módulo.`,
    );
  }

  if (counts.unclaimed > 0) {
    lines.push(
      counts.unclaimed === 1
        ? "1 envio de um acesso anterior não sai sozinho: confirme na tela de envios pendentes se ele é seu."
        : `${counts.unclaimed} envios de um acesso anterior não saem sozinhos: confirme na tela de envios pendentes se eles são seus.`,
    );
  }

  if (counts.drafts > 0) {
    lines.push(
      `${plural(counts.drafts, "formulário em preenchimento", "formulários em preenchimento")} ${
        counts.drafts === 1 ? "será descartado" : "serão descartados"
      }.`,
    );
  }

  if (counts.pending > 0 && connection.isOffline) {
    lines.push("Sem conexão agora: não é possível enviar antes de sair.");
  } else if (counts.pending > 0 && connection.sendIncomplete) {
    lines.push(SEND_NOW_INCOMPLETE_MESSAGE);
  }

  const hasRisk = lines.length > 0;
  const canActOnQueue = connection.canActOnQueue ?? true;

  return {
    hasRisk,
    title: hasRisk ? "Sair com pendências?" : "Sair da conta?",
    lines,
    confirmLabel: hasRisk ? "Sair mesmo assim" : "Confirmar saída",
    canSendNow: canActOnQueue && counts.pending > 0 && !connection.isOffline,
    canReviewQueue: canActOnQueue && queued + counts.unclaimed > 0,
  };
}

export { countOpenDrafts, logoutWarning };
export type { LogoutContext, LogoutQueueCounts, LogoutWarning };
