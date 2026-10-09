import {
  isPauseOutboxKind,
  pauseRefusalVerdict,
  type PauseRefusalVerdict,
} from "@/features/pauses/pause-rules";
import {
  ON_THE_WAY_KIND,
  onTheWayRefusalVerdict,
  type OnTheWayRefusalVerdict,
} from "@/features/deliveries/on-the-way-rules";

import type { FailureDescription } from "./outbox-rules";

/**
 * Refusals that some kinds read as "done" or as "not yet", per their app
 * contracts (docs/contratos-app/pauses.md and on-the-way.md).
 *
 * The queue reads every refusal on the merits as a failure the driver has to
 * see. For a pause and for "a caminho" some refusals are nothing of the sort:
 * a pause already ended, a start whose own end is queued, a stop already
 * reached. Showing those as red cards would ask the driver to decide about
 * something that needs no decision. Pure: the queue passes the refusal and
 * the queue as it is now; the answer is data.
 */

type KindRefusalVerdict = PauseRefusalVerdict | OnTheWayRefusalVerdict;

type SettledVerdict = Extract<NonNullable<KindRefusalVerdict>, { outcome: "settled" }>;

interface RefusedItem {
  id: string;
  kind: string;
  status: string;
  businessId: string;
  ownerUserId?: string;
  endpoint: string;
  body: Record<string, unknown>;
  createdAt: string;
}

/** Whether the kind has refusal rules of its own (and so needs the queue read). */
function hasRefusalRules(kind: string): boolean {
  return isPauseOutboxKind(kind) || kind === ON_THE_WAY_KIND;
}

function refusalVerdict(
  item: RefusedItem,
  failure: FailureDescription,
  queue: readonly RefusedItem[],
): KindRefusalVerdict {
  // Only an answer from the API on the merits: a timeout, a lost session or a
  // module switched off keep their own handling.
  if (failure.source !== "api") return null;
  if (failure.isAuthenticationError || failure.isTransient) return null;

  if (isPauseOutboxKind(item.kind)) {
    return pauseRefusalVerdict(item, failure.code, queue);
  }

  if (item.kind === ON_THE_WAY_KIND) {
    return onTheWayRefusalVerdict(item, failure.code, queue);
  }

  return null;
}

export { hasRefusalRules, refusalVerdict };
export type { KindRefusalVerdict, RefusedItem, SettledVerdict };
