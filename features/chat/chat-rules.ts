import type { ChatMessage, ClientChatMessage } from "./types";

/**
 * The four states a message of the driver's own can be in, from the clock to
 * the blue double check. `failed` is deliberately not one of them: a send
 * that never landed has its own retry affordance, not a check.
 */
type OwnMessageCheck = "pending" | "sent" | "delivered" | "read";

/** The only thing the batch rule needs to know about a picked image. */
interface ChatImageCandidate {
  mimeType?: string | null;
}

/**
 * One row of the conversation. `messages` holds more than one only when
 * consecutive photos were folded into a grid.
 */
interface ChatFeedItem {
  key: string;
  messages: ClientChatMessage[];
}

interface ChatImageBatch<T> {
  accepted: T[];

  /** Refused for having no free slot left. */
  overLimit: number;

  /** Refused for declaring a type the chat does not take. */
  unsupportedType: number;
}

/** Mirrors the API's wire limit — the composer never sends what it refuses. */
const MAX_CHAT_MESSAGE_LENGTH = 2000;

/** How many images one send may carry — the composer stages no more. */
const MAX_CHAT_IMAGES_PER_SEND = 10;

/** What the picker may hand over before transcoding turns it into JPEG. */
const CHAT_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/**
 * How far apart two photos may be and still read as one batch. Long enough
 * to cover a slow upload on a bad connection, short enough that two separate
 * things the driver photographed do not get merged into one.
 */
const IMAGE_GROUP_WINDOW_MS = 2 * 60 * 1000;

/** A tap that barely grazed the mic is noise, not a voice note. */
const MIN_AUDIO_DURATION_MS = 1_000;

/**
 * The ceiling on a voice note, mirroring the API's `CHAT_AUDIO_MAX_DURATION_MS`.
 *
 * Two minutes, not fifteen. Fifteen minutes is not an operational message, it
 * is a meeting: nobody at the SAC sits through one, and the driver would only
 * discover the limit by being refused AFTER speaking. Two minutes is as long
 * as a spoken note anyone actually listens to, and the recorder now stops
 * itself there with a countdown beforehand — so the ceiling is something the
 * driver sees coming instead of something that rejects them afterwards.
 *
 * This constant is the app's ONLY copy of that number. Anything that needs it
 * — the recorder, the composer, the cache sizing — reads it from here.
 */
const MAX_AUDIO_DURATION_MS = 2 * 60 * 1000;

/**
 * How long before the ceiling the driver starts seeing a countdown.
 *
 * Long enough to finish the sentence being spoken, short enough that it is not
 * a nag on every note. A limit announced only by cutting the recording off is
 * the same limit, minus the courtesy.
 */
const AUDIO_COUNTDOWN_LEAD_MS = 15_000;

/** Why a finished recording cannot be sent, or `null` when it can. */
type RecordingRejection = "too-short" | "too-long";

/** In the driver's thread, everything not sent by the driver is the SAC. */
function isFromOperation(message: ChatMessage, myUserId: string): boolean {
  return message.senderId !== myUserId;
}

/**
 * Whether a counterpart cursor already covers a message. Both the read and
 * the delivery state are derived this way — no per-message receipt exists
 * anywhere, so a single instant per side is all there is to compare against.
 */
function cursorCovers(createdAt: string, cursor: string | null): boolean {
  if (!cursor) return false;

  return new Date(createdAt) <= new Date(cursor);
}

/**
 * The double check: read state is DERIVED from the counterpart's cursor —
 * no per-message receipt exists anywhere, so this is cheap and honest.
 */
function wasReadByCounterpart(
  createdAt: string,
  counterpartLastReadAt: string | null,
): boolean {
  return cursorCovers(createdAt, counterpartLastReadAt);
}

/**
 * The grey double check: the counterpart's device (for the driver, some open
 * SAC panel) confirmed HOLDING the message. A separate cursor from the read
 * one, and never a substitute for it.
 */
function wasDeliveredToCounterpart(
  createdAt: string,
  counterpartDeliveredAt: string | null,
): boolean {
  return cursorCovers(createdAt, counterpartDeliveredAt);
}

/**
 * What the checks under one of the driver's OWN messages must show.
 *
 * The precedence is not cosmetic: `pending > read > delivered > sent`. Read
 * always wins over delivered because the two cursors move independently —
 * the SAC's read cursor can legitimately sit ahead of the delivery one, and a
 * delivery receipt that arrives late must never demote a message the base has
 * demonstrably already read. A check that walks backwards is worse than a
 * check that is one step behind.
 */
function resolveOwnMessageCheck(input: {
  createdAt: string;
  pending?: boolean;
  counterpartReadAt: string | null;
  counterpartDeliveredAt: string | null;
}): OwnMessageCheck {
  if (input.pending) return "pending";

  if (wasReadByCounterpart(input.createdAt, input.counterpartReadAt)) {
    return "read";
  }

  if (wasDeliveredToCounterpart(input.createdAt, input.counterpartDeliveredAt)) {
    return "delivered";
  }

  return "sent";
}

/** The later of two ISO instants; either side may be missing. */
function latestIso(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null {
  if (!a) return b ?? null;
  if (!b) return a;

  return new Date(a) > new Date(b) ? a : b;
}

/**
 * The instant to confirm delivery with: the newest message that actually
 * came from the operation over the wire.
 *
 * Two things are deliberately discarded. The driver's own messages, because
 * a device does not acknowledge receiving what it just sent. And optimistic
 * copies (pending or failed), because their `created_at` is a local clock
 * the server never issued — confirming one would push the delivery cursor
 * past messages the SAC is still waiting on.
 */
function newestDeliverableAt(
  messages: ClientChatMessage[],
  myUserId: string,
): string | null {
  return messages.reduce<string | null>((newest, message) => {
    if (message.pending || message.failed) return newest;
    if (!isFromOperation(message, myUserId)) return newest;
    if (!message.created_at) return newest;

    return latestIso(newest, message.created_at);
  }, null);
}

function byConversationOrder(a: ChatMessage, b: ChatMessage): number {
  const byDate =
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();

  return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
}

/**
 * Folds a socket arrival into the ascending list. The same message may
 * arrive twice (own send confirmed over HTTP and echoed by the socket):
 * an id match is a no-op, a submission-id match replaces the optimistic
 * copy with the server truth.
 */
function mergeIncomingMessage(
  list: ClientChatMessage[],
  incoming: ChatMessage,
): ClientChatMessage[] {
  if (list.some((message) => message.id === incoming.id)) return list;

  const optimisticIndex = incoming.client_submission_id
    ? list.findIndex(
        (message) =>
          message.client_submission_id === incoming.client_submission_id,
      )
    : -1;

  if (optimisticIndex >= 0) {
    const next = [...list];

    next[optimisticIndex] = incoming;
    return next;
  }

  return [...list, incoming].sort(byConversationOrder);
}

/**
 * The optimistic copy a server message is about to replace, if any.
 *
 * Only a submission-id match counts, and only when the server id is not in
 * the list yet — the same test `mergeIncomingMessage` uses to decide to swap.
 * The caller needs it BEFORE the swap: a voice note recorded on this phone
 * has to be filed under the server id first, or the bubble that remounts
 * under that id asks the driver to download their own note (MOB-21).
 */
function findOptimisticCopy(
  list: ClientChatMessage[],
  incoming: ChatMessage,
): ClientChatMessage | null {
  if (!incoming.client_submission_id) return null;
  if (list.some((message) => message.id === incoming.id)) return null;

  return (
    list.find(
      (message) =>
        message.client_submission_id === incoming.client_submission_id,
    ) ?? null
  );
}

/** A message the server has not confirmed: still sending, or failed. */
function isUnconfirmed(message: ClientChatMessage): boolean {
  return Boolean(message.pending || message.failed);
}

/** The keyset cursor the API pages history with. */
interface ChatHistoryCursor {
  created_at: string;
  id: string;
}

/** One page of `/chat/list-messages`, newest first as the API answers. */
interface ChatHistoryPage {
  data: ChatMessage[];
  nextCursor: ChatHistoryCursor | null;
}

interface ChatHistory {
  /** Ascending, as the screen renders it. */
  messages: ClientChatMessage[];

  /** Where "Mensagens anteriores" continues from; `null` when nothing is older. */
  nextCursor: ChatHistoryCursor | null;
}

/**
 * Folds the NEWEST page into a conversation that is already on screen — the
 * resync after a reconnection, a return to the foreground or a pull to
 * refresh (MOB-05).
 *
 * The old reload replaced the list with the forty newest messages, which
 * threw away whatever the driver had paged in with "Mensagens anteriores". A
 * resync has no business doing that: it only has to add what was missed. So
 * the page is merged by identity — a message already on screen is refreshed
 * in place (its attachment arrives freshly signed), an optimistic copy is
 * swapped for the server's, anything new is sorted in — and the paging cursor
 * is left where the loaded history ends.
 *
 * The one exception is a GAP. When more messages arrived while the driver was
 * away than one page holds, the page no longer reaches back to what is on
 * screen, and merging would stitch two stretches of the thread together with
 * a hole between them that no cursor would ever fill. The page then REPLACES
 * the history (see `takeNewestPage`) and brings its own cursor, so "Mensagens
 * anteriores" pages back through the missing stretch. Messages marked
 * `afterGap` do not count as "on screen" for that test: the live socket can
 * deliver the newest message of a thread whose middle it missed.
 */
function mergeNewestPage(
  current: ClientChatMessage[],
  currentCursor: ChatHistoryCursor | null,
  page: ChatHistoryPage,
): ChatHistory {
  const incoming = [...page.data].sort(byConversationOrder);

  if (incoming.length === 0) {
    return { messages: current, nextCursor: currentCursor };
  }

  // A message the socket delivered after a drop may sit above a hole: it
  // says nothing about how far the loaded history really reaches.
  const contiguous = current.filter(
    (message) => !isUnconfirmed(message) && !message.afterGap,
  );

  const newestLoaded = contiguous.reduce<ClientChatMessage | null>(
    (newest, message) =>
      !newest || byConversationOrder(message, newest) > 0 ? message : newest,
    null,
  );

  // The page reaches what is on screen when it holds the whole thread, or
  // when its oldest message is not newer than the newest one already loaded.
  const reachesLoaded =
    !page.nextCursor ||
    (newestLoaded !== null && byConversationOrder(incoming[0], newestLoaded) <= 0);

  if (!newestLoaded || !reachesLoaded) return takeNewestPage(current, page);

  const fresh = new Map(incoming.map((message) => [message.id, message]));

  // Refreshed in place: same identity, freshly signed attachment.
  let merged: ClientChatMessage[] = current.map(
    (message) => fresh.get(message.id) ?? message,
  );

  incoming.forEach((message) => {
    merged = mergeIncomingMessage(merged, message);
  });

  return { messages: merged, nextCursor: currentCursor };
}

/**
 * The newest page AS the history, with its own cursor: the first load, and a
 * resync that found a gap (`mergeNewestPage`).
 *
 * Two kinds of message on screen survive it. Sends still on their way or
 * failed, which exist only on this phone (unless the page already confirms
 * them). And anything NEWER than the page's newest message: the socket is
 * global and already connected while the GET is in flight, so a SAC message
 * can arrive by `chatMessage` after the server took the page's snapshot. The
 * page cannot hold it, and dropping it would leave it invisible and unread
 * until some later catch-up (MOB-05).
 */
function takeNewestPage(
  current: ClientChatMessage[],
  page: ChatHistoryPage,
): ChatHistory {
  const incoming = [...page.data].sort(byConversationOrder);
  const newestOfPage = incoming[incoming.length - 1] ?? null;

  const kept = current.filter((message) => {
    if (isUnconfirmed(message)) {
      // An unconfirmed copy the page already confirms is replaced, not kept.
      return (
        !message.client_submission_id ||
        !incoming.some(
          (fresh) => fresh.client_submission_id === message.client_submission_id,
        )
      );
    }

    // An empty page is a snapshot of an empty thread: whatever the socket
    // brought since is newer than all of it.
    return !newestOfPage || byConversationOrder(message, newestOfPage) > 0;
  });

  return {
    messages: [...incoming, ...kept].sort(byConversationOrder),
    nextCursor: page.nextCursor,
  };
}

/**
 * Drops the `afterGap` mark once a catch-up that began with the socket up has
 * landed: that page plus what the socket delivered meanwhile is the whole
 * thread, so nothing on screen sits above a hole any more. The same array
 * comes back when nothing was marked, so a catch-up that found no gap does
 * not re-render the list.
 */
function clearGapMarks(list: ClientChatMessage[]): ClientChatMessage[] {
  if (!list.some((message) => message.afterGap)) return list;

  return list.map((message) => {
    if (!message.afterGap) return message;

    const unmarked = { ...message };
    delete unmarked.afterGap;

    return unmarked;
  });
}

/**
 * The `readAt` to report for what is on screen, or `null` when there is
 * nothing to report.
 *
 * The newest message FROM THE OPERATION the driver actually has in front of
 * them, as the server stamped it — never "now". Without it the API stamps its
 * own clock and the SAC sees blue checks on messages this phone never
 * received (MOB-05). It is the same instant the delivery receipt uses, for
 * the same reason: the server's `created_at` of something this device holds.
 *
 * A message marked `afterGap` is left out: the cursor covers everything
 * before it, and below it may sit a stretch of the thread this phone never
 * received. The catch-up that closes the gap swaps it for the server's copy,
 * which is reported then.
 */
function readCursorFor(
  displayed: ClientChatMessage[],
  myUserId: string,
): string | null {
  return newestDeliverableAt(
    displayed.filter((message) => !message.afterGap),
    myUserId,
  );
}

/** The HTTP confirmation of an optimistic send. */
function confirmOptimistic(
  list: ClientChatMessage[],
  clientSubmissionId: string,
  confirmed: ChatMessage,
): ClientChatMessage[] {
  return list.map((message) =>
    message.client_submission_id === clientSubmissionId ||
    message.id === confirmed.id
      ? confirmed
      : message,
  );
}

function markSendFailed(
  list: ClientChatMessage[],
  clientSubmissionId: string,
): ClientChatMessage[] {
  return list.map((message) =>
    message.client_submission_id === clientSubmissionId
      ? { ...message, pending: false, failed: true }
      : message,
  );
}

function markSendPending(
  list: ClientChatMessage[],
  clientSubmissionId: string,
): ClientChatMessage[] {
  return list.map((message) =>
    message.client_submission_id === clientSubmissionId
      ? { ...message, pending: true, failed: false }
      : message,
  );
}

/**
 * Why a finished recording cannot be sent — or `null` when it can.
 *
 * The reason is part of the answer because "não deu para enviar" is not one:
 * a graze and a marathon are opposite mistakes and the driver fixes them in
 * opposite ways.
 */
function whyRecordingIsNotSendable(
  durationMs: number,
): RecordingRejection | null {
  if (durationMs < MIN_AUDIO_DURATION_MS) return "too-short";
  if (durationMs > MAX_AUDIO_DURATION_MS) return "too-long";

  return null;
}

/** Whether a finished recording is worth sending. */
function recordingIsSendable(durationMs: number): boolean {
  return whyRecordingIsNotSendable(durationMs) === null;
}

/**
 * What the driver last ASKED the recorder for. Not what it is doing — the two
 * come apart on their own, which is the entire reason this type exists.
 */
type RecorderIntent = "recording" | "paused";

/** What the recorder itself says, put next to what the driver asked for. */
interface RecorderReconcileInput {
  /** The driver's standing instruction. */
  intent: RecorderIntent;

  /** Whether the microphone is capturing RIGHT NOW, as the recorder reports. */
  isRecording: boolean;

  /** Whether there is still a live session to act on at all. */
  canRecord: boolean;

  /** Whether the app is in the foreground. */
  isAppActive: boolean;
}

/** What has to be done to the recorder to make it obey the driver again. */
type RecorderReconcileAction = "none" | "pause" | "resume";

/**
 * How to put a recorder back under the driver's control after the SYSTEM moved
 * it on its own.
 *
 * `expo-audio` drives the recorder behind the app's back on every foreground
 * and background transition: entering the background it pauses whatever is
 * capturing, and entering the foreground it RESUMES anything it finds paused —
 * including a hold the driver asked for. Neither is announced, and the order
 * between the native handler and any JS listener is not defined. So this never
 * asks what the system did; it compares what the driver wants with what the
 * recorder currently reports, and names the correction.
 *
 * The two asymmetries are deliberate.
 *
 * A hold is re-imposed WHEREVER it is noticed, foreground or not: the driver
 * pressed pause, and a microphone that started itself again under a UI reading
 * "Pausado" is the worst state this can be in — it is how a ten-minute file
 * gets sent declared as forty-two seconds.
 *
 * A resume happens only while the app is ACTIVE. When the app is in the
 * background the system's pause is not a glitch to undo, it is the platform
 * refusing to record there; fighting it would either fail or, worse, succeed
 * and record the driver while they are in another app.
 */
function reconcileRecorderState(
  input: RecorderReconcileInput,
): RecorderReconcileAction {
  if (input.intent === "paused") {
    return input.isRecording ? "pause" : "none";
  }

  if (input.isRecording) return "none";

  // Nothing to resume: the session is gone, and only a stop can tidy that up.
  if (!input.canRecord) return "none";

  return input.isAppActive ? "resume" : "none";
}

/**
 * How often the recorder is asked how long it has recorded WHILE IT IS
 * CAPTURING. It is also the tolerance a reading taken on this watch is
 * allowed: the ceiling can only be crossed by up to one beat before the poll
 * notices it.
 */
const RECORDING_TICK_MS = 250;

/**
 * How often a HELD recording is checked on.
 *
 * A hold has no clock to animate, so this is not a timer — it is a watch. The
 * system resumes paused recorders on its own (see `reconcileRecorderState`)
 * and announces nothing, so something has to keep looking. A slow beat is
 * enough: it bounds how long a microphone can run against the driver's wishes,
 * and it costs one status read per second.
 *
 * It is FOUR TIMES the capturing beat, which is exactly why the clamp below
 * cannot be handed a fixed number: a recorder the system restarted behind a
 * hold can be up to a whole second past the ceiling before anyone looks.
 */
const PAUSED_WATCH_MS = 1_000;

/**
 * How often a recorder is looked at, given what the driver last asked of it.
 *
 * The same number answers two questions, and that is the point: how long the
 * app may go without looking, and therefore how far past the ceiling a
 * recording may legitimately be found. Deriving both from one place is what
 * keeps `reportedRecordingMs` honest about the watch that actually produced
 * its reading.
 */
function recorderWatchPeriodMs(intent: RecorderIntent): number {
  return intent === "paused" ? PAUSED_WATCH_MS : RECORDING_TICK_MS;
}

/**
 * The recorded length to trust, given what the recorder just reported and what
 * it had already reported before.
 *
 * The recorder is the ONLY honest source for this. A wall clock in JS measures
 * how long ago something started, which stops being the same number the moment
 * the system pauses or resumes the microphone without telling anyone — and the
 * file always sides with the recorder. `durationMillis` is the module's own
 * accumulation: it advances only while capturing and freezes across a hold,
 * whoever asked for that hold.
 *
 * Two guards, both about not lying to the driver.
 *
 * `null` means the status could not be read at all. That is not zero — it is
 * "no news" — so the last known length stands and the clock simply stops
 * moving rather than collapsing to 0:00.
 *
 * And the length never walks backwards. A stopped or errored recorder reports
 * 0 on both platforms, and letting that through would erase, on the very last
 * read, the seconds the driver actually recorded.
 */
function recorderClockMs(
  reportedMs: number | null,
  lastKnownMs: number,
): number {
  const floor = Math.max(0, lastKnownMs);

  if (reportedMs === null || !Number.isFinite(reportedMs)) return floor;

  return Math.max(floor, Math.round(Math.max(0, reportedMs)));
}

/** What is left of the allowance, never negative. */
function recordingRemainingMs(elapsedMs: number): number {
  return Math.max(0, MAX_AUDIO_DURATION_MS - elapsedMs);
}

/** Whether the recorder has to stop itself now. */
function recordingReachedLimit(elapsedMs: number): boolean {
  return elapsedMs >= MAX_AUDIO_DURATION_MS;
}

/**
 * The seconds to show in "faltam Ns", or `null` while the ceiling is still far
 * enough away to be nobody's business.
 *
 * Rounded UP, so the number the driver reads is never optimistic: "faltam 1s"
 * means there is still up to a second left, not that the cut already happened.
 */
function recordingCountdownSeconds(elapsedMs: number): number | null {
  const remaining = recordingRemainingMs(elapsedMs);

  if (remaining > AUDIO_COUNTDOWN_LEAD_MS) return null;

  return Math.ceil(remaining / 1000);
}

/**
 * The length to declare for a finished recording.
 *
 * The recorder is watched on a beat, so a recording the ceiling stopped can
 * measure a handful of milliseconds PAST it. Refusing a note for overrunning a
 * limit the app itself enforced would be indefensible, so an overshoot within
 * ONE BEAT OF THE WATCH THAT WAS ACTUALLY RUNNING is reported as the ceiling
 * exactly. Anything beyond that is reported as measured — a watch starved by
 * the OS can leave a genuinely oversized recording behind, and rounding that
 * down would lie to the server instead of refusing honestly.
 *
 * `toleranceMs` is therefore not a constant: it is the period of the watch
 * that produced `elapsedMs` (see `recorderWatchPeriodMs`). A held recording is
 * watched four times more slowly than a capturing one, and clamping its
 * reading against the capturing beat is how two minutes of speech get thrown
 * away for being 120.6 seconds long.
 */
function reportedRecordingMs(elapsedMs: number, toleranceMs: number): number {
  const overshoot = elapsedMs - MAX_AUDIO_DURATION_MS;

  if (overshoot > 0 && overshoot <= toleranceMs) return MAX_AUDIO_DURATION_MS;

  return elapsedMs;
}

/** "0:42" — the voice note length next to the player. */
function formatAudioClock(durationMs: number | null): string {
  const totalSeconds = Math.max(0, Math.round((durationMs ?? 0) / 1000));

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * What the other side is doing RIGHT NOW, when it is worth saying at all.
 *
 * The two hints travel on their own socket events and can be lit in the same
 * instant — the SAC panel has a keyboard and a microphone side by side, and a
 * hand on one does not free the other. Which sentence wins is decided here,
 * once, so the header line and the bubble at the end of the thread can never
 * contradict each other.
 */
type ChatPresenceHint = "typing" | "recording";

interface ChatPresenceInput {
  /** A "digitando" is currently standing. */
  isTyping: boolean;

  /** A "gravando" is currently standing. */
  isRecording: boolean;
}

/**
 * Recording beats typing whenever both are lit, because it is the more
 * specific of the two. "Digitando" is what any keystroke means; "gravando um
 * áudio" says what is actually coming and roughly how long it is worth
 * waiting for it.
 */
function chatPresenceHint(input: ChatPresenceInput): ChatPresenceHint | null {
  if (input.isRecording) return "recording";
  if (input.isTyping) return "typing";

  return null;
}

/** The line the driver reads under "Chat com a operação". */
function chatPresenceHintLabel(hint: ChatPresenceHint): string {
  return hint === "recording" ? "gravando um áudio..." : "digitando...";
}

/** The same fact spoken out loud, for the bubble in the thread. */
function chatPresenceHintAccessibilityLabel(hint: ChatPresenceHint): string {
  return hint === "recording"
    ? "A operação está gravando um áudio"
    : "A operação está digitando";
}

/**
 * How often the driver's own "digitando" goes out while they keep writing.
 * One event per keystroke would be a flood for a hint nobody would miss.
 */
const TYPING_EMIT_THROTTLE_MS = 2_500;

/**
 * How often the driver's own "gravando" goes out WHILE THE MICROPHONE IS
 * REALLY CAPTURING.
 *
 * A recording now announces itself the way typing always has: as a pulse,
 * not as a pair of edges. The edges were the mistake. A "started" that is
 * never repeated puts the entire correction on a "stopped" that has a dozen
 * ways of never being sent — the socket dies, the app is killed, the phone
 * loses signal, the system takes the microphone away in the background — and
 * every one of them left "gravando um áudio..." standing on the other side
 * for as long as the safety window lasted.
 *
 * A note lasts two minutes at most, so this is sixty events per recording at
 * the very worst: fewer than the same driver's keyboard emits while writing
 * a single paragraph.
 */
const RECORDING_EMIT_PULSE_MS = 2_000;

/**
 * How long a received "digitando" stands with no further news.
 *
 * Longer than the throttle above — the other side re-announces itself while
 * the keys keep moving, so anything shorter would blink the line off between
 * two perfectly ordinary announcements. Short enough that it disappears on
 * its own the moment they stop.
 */
const TYPING_HINT_TTL_MS = 3_500;

/**
 * How long a received "gravando" stands with no further news.
 *
 * The same shape as the typing window, for the same reason: comfortably wider
 * than the gap between two pulses — a whole pulse can be lost without the
 * bubble blinking — and short enough that a "gravando" nobody is producing
 * any more disappears while the driver is still looking at the screen.
 *
 * It is deliberately NOT derived from the audio ceiling any more. The window
 * used to be a whole note plus thirty seconds, which was not a window at all
 * but a confession: the hint could only be put out by a message that might
 * never come. Silence is the message now, and silence takes four seconds.
 */
const RECORDING_HINT_TTL_MS = 5_000;

/**
 * Everything that varies per hint, in one table.
 *
 * A `Record` and not ternaries, because a ternary has an else: a third hint
 * would silently inherit typing's numbers and blink on the other side with
 * the compiler and the suite green. Adding a member to `ChatPresenceHint`
 * now fails to compile until its row exists.
 *
 * `survivesLostPulse` is the honest part. Recording MUST survive one: it is
 * a long quiet stretch and a blink there reads as "they gave up". Typing
 * must NOT be padded that far — it heals on the very next keystroke, and a
 * window wide enough to swallow a lost pulse would leave "digitando..." on
 * screen five seconds after the person stopped, which is the worse lie.
 */
const HINT_TIMINGS: Record<
  ChatPresenceHint,
  { ttlMs: number; pulseMs: number; beatMs: number; survivesLostPulse: boolean }
> = {
  recording: {
    ttlMs: RECORDING_HINT_TTL_MS,
    pulseMs: RECORDING_EMIT_PULSE_MS,

    // The emitter can only fire on the recorder's own beat, so two pulses
    // are never closer than the interval and never further than the interval
    // plus one beat. The window has to be measured against THAT, not against
    // the nominal interval — asserting the nominal is how the invariant read
    // green while the property did not hold.
    beatMs: RECORDING_TICK_MS,
    survivesLostPulse: true,
  },
  typing: {
    ttlMs: TYPING_HINT_TTL_MS,
    pulseMs: TYPING_EMIT_THROTTLE_MS,

    // Emitted straight from the keystroke, with no beat in between.
    beatMs: 0,
    survivesLostPulse: false,
  },
};

/** Every hint, so a test can walk all of them and never miss a new one. */
const EVERY_PRESENCE_HINT = Object.keys(HINT_TIMINGS) as ChatPresenceHint[];

/** How long a hint stands before it is dropped for lack of news. */
function chatHintTtlMs(hint: ChatPresenceHint): number {
  return HINT_TIMINGS[hint].ttlMs;
}

/** How often a hint of a given kind is re-announced while it stays true. */
function chatHintPulseMs(hint: ChatPresenceHint): number {
  return HINT_TIMINGS[hint].pulseMs;
}

/**
 * The longest gap the other side can actually see between two pulses.
 *
 * The interval is when the emitter WANTS to fire; the beat is how coarsely it
 * gets asked. The window is only a safety net against the sum.
 */
function chatHintMaxGapMs(hint: ChatPresenceHint): number {
  return HINT_TIMINGS[hint].pulseMs + HINT_TIMINGS[hint].beatMs;
}

/** Whether this hint's window is wide enough to swallow one lost pulse. */
function chatHintSurvivesLostPulse(hint: ChatPresenceHint): boolean {
  return HINT_TIMINGS[hint].survivesLostPulse;
}

interface PresencePulseInput {
  nowMs: number;

  /** When the last pulse went out, or `null` if none ever did. */
  lastPulseAtMs: number | null;

  /** The gap this kind of hint keeps between pulses. */
  everyMs: number;
}

/**
 * Whether a presence pulse is due.
 *
 * `null` always pulses: the first keystroke and the first captured
 * millisecond are exactly when the other side has been in the dark longest.
 */
function presencePulseIsDue(input: PresencePulseInput): boolean {
  if (input.lastPulseAtMs === null) return true;

  return input.nowMs - input.lastPulseAtMs >= input.everyMs;
}

/**
 * Splits what the picker returned into what may be staged and what has to be
 * refused — and counts the refusals BY REASON, because "5 fotos não entraram"
 * is not an explanation. A driver who picked fifteen deserves to know that
 * ten went in and five hit the ceiling, which is a different problem from a
 * file the app cannot read.
 *
 * Order matters: the type check runs first, so a file that would have been
 * refused anyway never burns one of the ten slots.
 *
 * A candidate with NO declared type is let through. The app cannot prove it
 * invalid, transcoding is the real gate, and refusing on a missing field
 * would turn a picker quirk into a photo the driver cannot send.
 */
function splitChatImageBatch<T extends ChatImageCandidate>(
  candidates: T[],
  stagedCount: number,
): ChatImageBatch<T> {
  const supported: T[] = [];
  let unsupportedType = 0;

  candidates.forEach((candidate) => {
    const mimeType = candidate.mimeType?.toLowerCase().trim();

    if (
      !mimeType ||
      (CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)
    ) {
      supported.push(candidate);
      return;
    }

    unsupportedType += 1;
  });

  const freeSlots = Math.max(0, MAX_CHAT_IMAGES_PER_SEND - stagedCount);

  return {
    accepted: supported.slice(0, freeSlots),
    overLimit: Math.max(0, supported.length - freeSlots),
    unsupportedType,
  };
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Whether a date pill belongs between the previous message and this one. */
function needsDaySeparator(
  previousCreatedAt: string | undefined,
  createdAt: string,
): boolean {
  if (!previousCreatedAt) return true;

  return !isSameCalendarDay(new Date(previousCreatedAt), new Date(createdAt));
}

function formatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);

  if (isSameCalendarDay(date, now)) return "Hoje";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameCalendarDay(date, yesterday)) return "Ontem";

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Whether a message can sit inside a photo grid at all.
 *
 * A failed send is deliberately excluded: its bubble carries the "toque para
 * reenviar" affordance, and a tile in a grid has nowhere to put it. A
 * broadcast is excluded for the same kind of reason — its megaphone label is
 * the point of the bubble.
 */
function isGroupableImage(message: ClientChatMessage): boolean {
  return (
    message.kind === "IMAGE" &&
    Boolean(message.attachment_url) &&
    !message.failed &&
    !message.broadcast_id
  );
}

/**
 * Whether `next` belongs to the grid `previous` is already part of.
 *
 * The caption rule is the subtle one: a photo carrying a body CLOSES its
 * group. A batch sent from this app puts the caption on the last photo, so
 * letting a later photo join would print the caption in the middle of the
 * grid, describing images that came after it.
 */
function continuesImageGroup(
  previous: ClientChatMessage,
  next: ClientChatMessage,
): boolean {
  if (!isGroupableImage(next)) return false;
  if (next.senderId !== previous.senderId) return false;
  if (previous.body) return false;

  // A grid must never straddle a date pill.
  if (needsDaySeparator(previous.created_at, next.created_at)) return false;

  const gap =
    new Date(next.created_at).getTime() -
    new Date(previous.created_at).getTime();

  return gap >= 0 && gap <= IMAGE_GROUP_WINDOW_MS;
}

/**
 * Folds the conversation into what the list actually renders: mostly one
 * message per row, and a single row wherever consecutive photos from the same
 * sender arrived close enough together to read as one batch.
 *
 * A group of one is not a group — a lone photo keeps its full-size bubble.
 */
function groupChatMessages(messages: ClientChatMessage[]): ChatFeedItem[] {
  const feed: ChatFeedItem[] = [];

  let index = 0;

  while (index < messages.length) {
    const first = messages[index];
    const group = [first];

    if (isGroupableImage(first)) {
      while (
        index + group.length < messages.length &&
        continuesImageGroup(
          group[group.length - 1],
          messages[index + group.length],
        )
      ) {
        group.push(messages[index + group.length]);
      }
    }

    feed.push({ key: first.id, messages: group });
    index += group.length;
  }

  return feed;
}

function formatMessageClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_IMAGES_PER_SEND,
  CHAT_IMAGE_MIME_TYPES,
  splitChatImageBatch,
  IMAGE_GROUP_WINDOW_MS,
  groupChatMessages,
  MIN_AUDIO_DURATION_MS,
  MAX_AUDIO_DURATION_MS,
  AUDIO_COUNTDOWN_LEAD_MS,
  RECORDING_TICK_MS,
  EVERY_PRESENCE_HINT,
  chatHintMaxGapMs,
  chatHintSurvivesLostPulse,
  PAUSED_WATCH_MS,
  recorderWatchPeriodMs,
  isFromOperation,
  wasReadByCounterpart,
  wasDeliveredToCounterpart,
  resolveOwnMessageCheck,
  latestIso,
  newestDeliverableAt,
  mergeIncomingMessage,
  findOptimisticCopy,
  isUnconfirmed,
  mergeNewestPage,
  takeNewestPage,
  clearGapMarks,
  readCursorFor,
  confirmOptimistic,
  markSendFailed,
  markSendPending,
  recordingIsSendable,
  whyRecordingIsNotSendable,
  reconcileRecorderState,
  recorderClockMs,
  recordingRemainingMs,
  recordingReachedLimit,
  recordingCountdownSeconds,
  reportedRecordingMs,
  formatAudioClock,
  TYPING_EMIT_THROTTLE_MS,
  TYPING_HINT_TTL_MS,
  RECORDING_EMIT_PULSE_MS,
  RECORDING_HINT_TTL_MS,
  chatHintTtlMs,
  chatHintPulseMs,
  presencePulseIsDue,
  chatPresenceHint,
  chatPresenceHintLabel,
  chatPresenceHintAccessibilityLabel,
  needsDaySeparator,
  formatDayLabel,
  formatMessageClock,
};

export type {
  OwnMessageCheck,
  RecordingRejection,
  RecorderIntent,
  RecorderReconcileInput,
  RecorderReconcileAction,
  ChatPresenceHint,
  ChatPresenceInput,
  PresencePulseInput,
  ChatImageCandidate,
  ChatImageBatch,
  ChatFeedItem,
  ChatHistory,
  ChatHistoryCursor,
  ChatHistoryPage,
};
