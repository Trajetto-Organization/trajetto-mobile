/**
 * The automatic reading of a proof photo, back to the driver who took it
 * (decision 6.9; docs/contratos-app/ai-feedback.md).
 *
 * The API tells the driver once, by push and by an inbox row, when the
 * reading suggests a problem. This keeps the latest warning per delivery on
 * the phone, so the delivery itself can show it — the proven delivery has
 * left the working list, and the push is gone from the tray once tapped.
 *
 * Pure and import-free: what the driver is told is a product decision, and a
 * decision that needs a device to test is one nobody tests.
 */

/** The inbox row's `type` (`GET /notification/stream`, socket `pushNotification`). */
const PROOF_FEEDBACK_NOTIFICATION_TYPE = "delivery-proof-ai";

/** The push's `data.type`. */
const PROOF_FEEDBACK_PUSH_TYPE = "delivery-proof.ai-flagged";

/** How long a warning is kept: the app's offline horizon. */
const PROOF_FEEDBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bound per driver and company: a week of stops, many times over. */
const MAX_PROOF_FEEDBACK_ENTRIES = 200;

const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One warning, whichever channel brought it. */
interface ProofFeedback {
  deliveryId: string;
  title: string;
  message: string;

  /**
   * When it was raised, on the server side: the row's `created_at` for the
   * inbox and the socket; for a push, when FCM sent it. On Android,
   * expo-notifications dates a remote push with FCM's `google.sent_time`,
   * not with the phone's clock (its Notification.java: "time when it was
   * sent (remote)").
   */
  at: string;

  /** The inbox row, when the channel names it; a push does not. */
  notificationId: string | null;

  /**
   * Heard the moment it was raised: a socket row. The API emits it as it
   * creates the row, and a socket that was down loses it (no replay), so
   * its arrival is its birth on the phone's clock.
   */
  live: boolean;
}

interface StoredProofFeedback extends ProofFeedback {
  /** When this phone first learned of it (phone clock). */
  receivedAt: number;
}

/**
 * The warning the delivery held at the tap: the last one about the photo a
 * new proof replaces, and where that photo's warnings end.
 */
type ReplacedProofFeedback = Pick<
  StoredProofFeedback,
  "at" | "notificationId" | "receivedAt"
>;

/**
 * A new proof of a delivery, tapped on this phone. Warnings about the photo
 * it replaces stop showing (the contract: no warning once the photo was
 * replaced by a new proof).
 */
interface NewProofMark {
  /** The driver's tap on "Comprovar" (phone clock), before the send. */
  tappedAt: number;

  /** The warning held at that tap, or `null` when the phone had heard none. */
  replaced: ReplacedProofFeedback | null;
}

/** Everything kept for one driver in one company. */
interface ProofFeedbackState {
  byDelivery: Record<string, StoredProofFeedback>;

  /** The latest proof of each delivery tapped on this phone. */
  newProofs: Record<string, NewProofMark>;
}

const EMPTY_PROOF_FEEDBACK_STATE: ProofFeedbackState = {
  byDelivery: {},
  newProofs: {},
};

/** Two copies of one warning when one is a push (it names no row). */
const SAME_WARNING_WINDOW_MS = 10 * 60 * 1000;

/**
 * How far the phone's clock may be from the server's. Used only when the
 * phone held no warning at the tap to tie the tap to the server's clock.
 */
const PHONE_CLOCK_MARGIN_MS = 10 * 60 * 1000;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const isDeliveryId = (value: unknown): value is string =>
  typeof value === "string" && DELIVERY_ID.test(value);

const isInstant = (value: string): boolean => !Number.isNaN(Date.parse(value));

/**
 * From an inbox row or its socket twin; `null` for any other kind.
 * `live` for the socket, which hears a row as it is created.
 */
function proofFeedbackFromNotification(
  row: {
    id?: unknown;
    type?: unknown;
    entityId?: unknown;
    title?: unknown;
    message?: unknown;
    created_at?: unknown;
  },
  options: { live?: boolean } = {},
): ProofFeedback | null {
  if (row.type !== PROOF_FEEDBACK_NOTIFICATION_TYPE) return null;
  if (!isDeliveryId(row.entityId)) return null;

  const message = text(row.message);
  const at = text(row.created_at);

  if (!message || !isInstant(at)) return null;

  return {
    deliveryId: row.entityId,
    title: text(row.title) || "Comprovante com possível problema",
    message,
    at: new Date(at).toISOString(),
    notificationId: text(row.id) || null,
    live: options.live === true,
  };
}

/**
 * From a push tapped in the tray, dated by when it was sent.
 *
 * The delivery's id is `data.entityId`, never `data.deliveryId`: the pipeline
 * stamps its own `deliveryId` (the id of the notification's delivery attempt)
 * on every push.
 */
function proofFeedbackFromPush(
  content: { title?: unknown; body?: unknown; data?: unknown },
  sentAt: Date,
): ProofFeedback | null {
  const data =
    content.data && typeof content.data === "object"
      ? (content.data as { type?: unknown; entityId?: unknown })
      : null;

  if (data?.type !== PROOF_FEEDBACK_PUSH_TYPE) return null;
  if (!isDeliveryId(data.entityId)) return null;

  const message = text(content.body);

  if (!message || Number.isNaN(sentAt.getTime())) return null;

  return {
    deliveryId: data.entityId,
    title: text(content.title) || "Comprovante com possível problema",
    message,
    at: sentAt.toISOString(),
    notificationId: null,
    live: false,
  };
}

/**
 * The problems the reading pointed at, one per line, or none when the
 * sentence is not the contract's (the card then shows the message whole).
 *
 * "Entrega para X. A leitura automática apontou: a; b. Se ainda estiver no
 * local, …" — the problems are already written as problems, in lower case.
 */
function proofFeedbackProblems(message: string): string[] {
  const match = /A leitura automática apontou: (.+?)\.\s+Se ainda estiver no local/.exec(
    message,
  );

  if (!match) return [];

  return match[1]
    .split(";")
    .map((problem) => problem.trim())
    .filter(Boolean);
}

/** Newest first when over the bound; expired entries out. */
function pruneProofFeedback(
  state: ProofFeedbackState,
  now: number,
): ProofFeedbackState {
  const byDelivery = Object.fromEntries(
    Object.entries(state.byDelivery)
      .filter(([, entry]) => now - entry.receivedAt <= PROOF_FEEDBACK_TTL_MS)
      .sort(([, left], [, right]) => right.receivedAt - left.receivedAt)
      .slice(0, MAX_PROOF_FEEDBACK_ENTRIES),
  );

  const newProofs = Object.fromEntries(
    Object.entries(state.newProofs)
      .filter(([, mark]) => now - mark.tappedAt <= PROOF_FEEDBACK_TTL_MS)
      .sort(([, left], [, right]) => right.tappedAt - left.tappedAt)
      .slice(0, MAX_PROOF_FEEDBACK_ENTRIES),
  );

  return { byDelivery, newProofs };
}

/**
 * Whether a warning is about a photo a later proof from this phone replaced.
 *
 * The tap is on the phone's clock and the warnings on the server's, and a
 * phone's clock can be minutes off. So each case compares one clock with
 * itself, and only the last resort crosses them, with a margin:
 *
 * 1. Heard at or before the tap: about the replaced photo, or an older one.
 * 2. Heard live after the tap: raised after it, so about the new photo.
 * 3. Read later (the inbox) or tapped late from the tray, with a warning
 *    held at the tap: that warning was raised no later than the phone heard
 *    it, and the tap came `tappedAt - receivedAt` after (a span of the
 *    phone's clock, whatever its error). Its `at` plus that span is, on the
 *    server's clock, at or before the tap: anything raised by then is old,
 *    anything about the new photo is raised after.
 * 4. Nothing held at the tap: only a warning well before the tap is old.
 */
function isAboutReplacedPhoto(
  feedback: StoredProofFeedback,
  mark: NewProofMark | undefined,
): boolean {
  if (!mark) return false;

  if (feedback.receivedAt <= mark.tappedAt) return true;

  if (feedback.live) return false;

  const at = Date.parse(feedback.at);
  const { replaced } = mark;

  if (replaced) {
    if (
      feedback.notificationId !== null &&
      feedback.notificationId === replaced.notificationId
    ) {
      return true;
    }

    return at <= Date.parse(replaced.at) + (mark.tappedAt - replaced.receivedAt);
  }

  return at <= mark.tappedAt - PHONE_CLOCK_MARGIN_MS;
}

/**
 * The state with one more warning heard.
 *
 * The same warning arrives up to three times (socket, push, inbox): the
 * delivery keeps the newest, and a copy of the one it already holds keeps
 * the moment it was first heard. A warning about a photo the driver's
 * latest proof replaced (`isAboutReplacedPhoto`) is not kept, nor one past
 * the offline horizon (an old row read again from the inbox after its
 * proof's mark was forgotten).
 */
function recordProofFeedback(
  state: ProofFeedbackState,
  feedback: ProofFeedback,
  now: number,
): ProofFeedbackState {
  const at = Date.parse(feedback.at);

  if (now - at > PROOF_FEEDBACK_TTL_MS) return state;

  const heard: StoredProofFeedback = { ...feedback, receivedAt: now };
  const mark = state.newProofs[feedback.deliveryId];

  if (isAboutReplacedPhoto(heard, mark)) return state;

  const held = state.byDelivery[feedback.deliveryId];

  // A held warning about a replaced photo is no longer the delivery's: the
  // next one takes its place whole, heard now, never merged into it.
  const current = held && !isAboutReplacedPhoto(held, mark) ? held : undefined;

  if (current) {
    const heldAt = Date.parse(current.at);

    const sameWarning =
      (feedback.notificationId !== null &&
        feedback.notificationId === current.notificationId) ||
      (current.message === feedback.message &&
        (current.notificationId === null || feedback.notificationId === null) &&
        Math.abs(heldAt - at) <= SAME_WARNING_WINDOW_MS);

    if (sameWarning) {
      // The inbox copy names the row the push could not. Kept: the earlier
      // of the two moments (the push is sent seconds after or before the row
      // is created), and the first time the phone heard of it.
      const merged: StoredProofFeedback = {
        ...current,
        notificationId: current.notificationId ?? feedback.notificationId,
        at: at < heldAt ? feedback.at : current.at,
        live: current.live || feedback.live,
      };

      return pruneProofFeedback(
        {
          ...state,
          byDelivery: { ...state.byDelivery, [feedback.deliveryId]: merged },
        },
        now,
      );
    }

    // An older warning arriving late (the inbox read after the socket).
    if (heldAt > at) return state;
  }

  return pruneProofFeedback(
    {
      ...state,
      byDelivery: { ...state.byDelivery, [feedback.deliveryId]: heard },
    },
    now,
  );
}

/**
 * The driver tapped "Comprovar" on this delivery again: the warning held at
 * the tap is about the photo the new proof replaces, and stops showing.
 *
 * `tappedAt` is the tap, before the send: a warning heard while the send is
 * in flight is about the new photo, and must not be merged into the old one.
 */
function markDeliveryProven(
  state: ProofFeedbackState,
  deliveryId: string,
  tappedAt: number,
  now: number,
): ProofFeedbackState {
  const previous = state.newProofs[deliveryId];

  // An older tap reaching the store after a newer one changes nothing.
  if (previous && previous.tappedAt >= tappedAt) return state;

  const held = state.byDelivery[deliveryId];

  const replaced: ReplacedProofFeedback | null =
    held && held.receivedAt <= tappedAt
      ? { at: held.at, notificationId: held.notificationId, receivedAt: held.receivedAt }
      : null;

  return pruneProofFeedback(
    {
      ...state,
      newProofs: { ...state.newProofs, [deliveryId]: { tappedAt, replaced } },
    },
    now,
  );
}

/** The warning the delivery shows, or `null`. */
function visibleProofFeedback(
  state: ProofFeedbackState,
  deliveryId: string,
): StoredProofFeedback | null {
  const entry = state.byDelivery[deliveryId];

  if (!entry) return null;

  return isAboutReplacedPhoto(entry, state.newProofs[deliveryId]) ? null : entry;
}

/**
 * What the driver can do about it.
 *
 * - `review`: the delivery is proven and with the office. Nothing to redo in
 *   the app (a proven delivery is final there); the words say what to check
 *   while still at the address.
 * - `retake`: the office reopened the delivery and it is in route again — a
 *   new photo of the receipt is what fixes it.
 * - `start-route`: reopened, but its route has not started, so it cannot be
 *   proven yet.
 *
 * "Reopened" is read only from a list fetched after the warning was heard:
 * an older list still holds the delivery as it was before the proof.
 */
type ProofFeedbackStep = "review" | "retake" | "start-route";

function proofFeedbackStep(input: {
  receivedAt: number;
  delivery: { status: string } | null;
  listUpdatedAt: number;
}): ProofFeedbackStep {
  if (!input.delivery) return "review";
  if (input.listUpdatedAt <= input.receivedAt) return "review";

  if (input.delivery.status === "IN_TRANSIT") return "retake";
  if (input.delivery.status === "PENDING") return "start-route";

  return "review";
}

const STEP_GUIDANCE: Record<ProofFeedbackStep, string> = {
  review:
    "É uma sugestão da leitura automática: a entrega continua registrada. Se ainda estiver no local, confira o canhoto com o destinatário. A equipe vai revisar o comprovante.",
  retake:
    "A equipe reabriu esta entrega. Comprove de novo com uma foto nítida do canhoto inteiro, com a assinatura e a data.",
  "start-route":
    "A equipe reabriu esta entrega. Inicie a rota para comprovar de novo, com uma foto nítida do canhoto inteiro.",
};

function proofFeedbackGuidance(step: ProofFeedbackStep): string {
  return STEP_GUIDANCE[step];
}

/**
 * Where a tap on an inbox row goes: the delivery it is about, inside the
 * app, instead of the web inbox its link points at. `null` for any other row,
 * or when this session cannot open deliveries (module off since).
 */
function notificationDeliveryTarget(
  row: { type?: unknown; entityId?: unknown },
  canOpenDeliveries: boolean,
): string | null {
  if (!canOpenDeliveries) return null;
  if (row.type !== PROOF_FEEDBACK_NOTIFICATION_TYPE) return null;

  return isDeliveryId(row.entityId) ? row.entityId : null;
}

export {
  EMPTY_PROOF_FEEDBACK_STATE,
  MAX_PROOF_FEEDBACK_ENTRIES,
  PHONE_CLOCK_MARGIN_MS,
  PROOF_FEEDBACK_NOTIFICATION_TYPE,
  PROOF_FEEDBACK_PUSH_TYPE,
  PROOF_FEEDBACK_TTL_MS,
  markDeliveryProven,
  notificationDeliveryTarget,
  proofFeedbackFromNotification,
  proofFeedbackFromPush,
  proofFeedbackGuidance,
  proofFeedbackProblems,
  proofFeedbackStep,
  pruneProofFeedback,
  recordProofFeedback,
  visibleProofFeedback,
};
export type {
  NewProofMark,
  ProofFeedback,
  ProofFeedbackState,
  ProofFeedbackStep,
  ReplacedProofFeedback,
  StoredProofFeedback,
};
