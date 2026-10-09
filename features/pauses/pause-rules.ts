/**
 * The driver's pause (decision 6.1), as the app decides it.
 *
 * Pure and import-free, like `outbox-rules` and `delivery-rules`: whether the
 * driver is on a pause, what the queue sends for it and what a refusal means
 * are decisions a test must read without a phone. The contract is
 * docs/contratos-app/pauses.md; the API (`driver-pause`) is the judge.
 */

const PAUSE_KINDS = ["MEAL", "REST", "OTHER"] as const;

type PauseKind = (typeof PAUSE_KINDS)[number];

/** The outbox kinds of the two gestures. `delivery-` puts them under Entregas. */
const PAUSE_START_KIND = "delivery-pause-start" as const;
const PAUSE_END_KIND = "delivery-pause-end" as const;

type PauseOutboxKind = typeof PAUSE_START_KIND | typeof PAUSE_END_KIND;

const PAUSE_NOTE_MAX_LENGTH = 200;

/** What the chooser offers, in the order the driver reads it. */
const PAUSE_KIND_OPTIONS: ReadonlyArray<{
  kind: PauseKind;
  label: string;
  description: string;
}> = [
  { kind: "MEAL", label: "Refeição", description: "Almoço, jantar ou lanche." },
  { kind: "REST", label: "Descanso", description: "Parada para descansar." },
  { kind: "OTHER", label: "Outra", description: "Qualquer outro motivo." },
];

const PAUSE_TITLES: Record<PauseKind, string> = {
  MEAL: "Pausa para refeição",
  REST: "Pausa para descanso",
  OTHER: "Pausa",
};

function isPauseKind(value: unknown): value is PauseKind {
  return typeof value === "string" && (PAUSE_KINDS as readonly string[]).includes(value);
}

function isPauseOutboxKind(kind: string): kind is PauseOutboxKind {
  return kind === PAUSE_START_KIND || kind === PAUSE_END_KIND;
}

/** "Pausa para refeição" — the banner's title. */
function pauseTitle(kind: PauseKind): string {
  return PAUSE_TITLES[kind];
}

/** The banner's title for an open pause: the company's type name when known. */
function openPauseTitle(open: Pick<OpenPause, "kind" | "typeName">): string {
  const name = open.typeName?.trim();

  return name ? `Pausa: ${name}` : pauseTitle(open.kind);
}

/** One choice of the pause picker. */
interface PauseChoice {
  /** The company's PAUSE type; null for the three fixed natures. */
  occurrenceTypeId: string | null;
  kind: PauseKind;
  label: string;
  description: string;
}

const KIND_NATURE: Record<PauseKind, string> = {
  MEAL: "Refeição",
  REST: "Descanso",
  OTHER: "Outra",
};

/**
 * What the picker offers (decision 14.4): the company's pause types from the
 * cached day, each with its legal nature; a day cached before the types has
 * none, and the three fixed natures go as `kind` alone (the API's adapter).
 */
function pauseChoicesOf(
  types: ReadonlyArray<{ id: string; name: string; pause_kind: string }> | null | undefined,
): PauseChoice[] {
  const usable = (types ?? []).filter((type) => isPauseKind(type.pause_kind));

  if (usable.length === 0) {
    return PAUSE_KIND_OPTIONS.map((option) => ({
      occurrenceTypeId: null,
      kind: option.kind,
      label: option.label,
      description: option.description,
    }));
  }

  return usable.map((type) => ({
    occurrenceTypeId: type.id,
    kind: type.pause_kind as PauseKind,
    label: type.name,
    description: `Natureza: ${KIND_NATURE[type.pause_kind as PauseKind]}`,
  }));
}

/** What the journey rule reads of the cached day. */
interface JourneyCache {
  data?: ReadonlyArray<{
    /** The delivery's own day (date-only), when the route's is not cached. */
    scheduled_date?: string | null;
    stops?: ReadonlyArray<{
      route?: { status?: string; scheduled_date?: string | null } | null;
    }> | null;
  }> | null;
  journey?: {
    pause_allowed?: boolean;
    /** The company's day the server judged (YYYY-MM-DD). */
    day?: string;
    /** The company's zone (IANA). */
    time_zone?: string;
  } | null;
}

/** The zone of a day cached without one: the company default (Business.timezone). */
const DEFAULT_BUSINESS_TIME_ZONE = "America/Sao_Paulo";

/** "YYYY-MM-DD" of `at` in `timeZone`; the default zone if it is not valid. */
function dateKeyIn(at: Date, timeZone: string): string {
  const format = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);

    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";

    return `${part("year")}-${part("month")}-${part("day")}`;
  };

  try {
    return format(timeZone);
  } catch {
    return format(DEFAULT_BUSINESS_TIME_ZONE);
  }
}

/**
 * The day of a date-only column ("2026-10-05" or its UTC-midnight ISO), or
 * null. Date-only values are read as written, never shifted to a zone.
 */
function dateOnlyKey(value: string | null | undefined): string | null {
  const match = typeof value === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(value) : null;

  return match ? match[1] : null;
}

/**
 * Whether "Iniciar pausa" is offered (decision 14.4): only inside a journey,
 * a route of the driver released or in progress that day. The API judges the
 * tap again (409 PAUSE_REQUIRES_ROUTE). An open pause is always ended: this
 * gates the start only.
 *
 * The server's `journey` decides only for the business day it was computed
 * in: the cache lives up to 7 days offline, and yesterday's "allowed" (or a
 * stale "not allowed") says nothing about today (review r1). Otherwise the
 * cached stops decide: a route IN_PROGRESS is a journey whatever its date (a
 * night route past midnight); a RELEASED one only on its own day. A stop with
 * no day cached at all keeps the benefit of the doubt — the API decides.
 */
function isPauseAllowed(
  cache: JourneyCache | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!cache) return false;

  const journey = cache.journey;
  const today = dateKeyIn(now, journey?.time_zone ?? DEFAULT_BUSINESS_TIME_ZONE);

  if (journey && typeof journey.pause_allowed === "boolean" && journey.day === today) {
    return journey.pause_allowed;
  }

  return (cache.data ?? []).some((delivery) =>
    (delivery.stops ?? []).some((stop) => {
      const status = stop.route?.status;

      if (status === "IN_PROGRESS") return true;
      if (status !== "RELEASED") return false;

      const day =
        dateOnlyKey(stop.route?.scheduled_date) ?? dateOnlyKey(delivery.scheduled_date);

      return day === null || day === today;
    }),
  );
}

/** The toast when the queue learns a pause fell outside a journey. */
const PAUSE_REQUIRES_ROUTE_NOTICE =
  "Pausas só valem durante uma rota liberada ou em andamento.";

/**
 * An open pause, wherever the app learned it: its own tap, or the server.
 *
 * `startSubmissionId` is what the end names, so a pause the server reports
 * (another install, a reinstall) can be ended like one tapped here.
 */
interface OpenPause {
  startSubmissionId: string;
  kind: PauseKind;

  /**
   * Decision 14.4: the company's pause type chosen, and its name for the
   * banner. Optional: a pause tapped before the types, or by an older build.
   */
  occurrenceTypeId?: string | null;
  typeName?: string | null;

  /** The tap on this phone, or the server's `started_at`. */
  startedAt: string;

  note: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * What this phone knows, persisted: the open pause (or none) and when that
 * last changed, by the phone's clock. Written at the tap, before sending.
 */
interface LocalPauseState {
  open: OpenPause | null;
  changedAt: number;
}

/** One `GET /driver-pause/current` answer, stamped when it was ASKED. */
interface ServerPauseSnapshot {
  open: OpenPause | null;
  requestedAt: number;
}

/** A queued item, as far as the pause rules read it. */
interface QueuedPauseItem {
  id: string;
  kind: string;
  status: string;
  businessId: string;
  ownerUserId?: string;
  body: Record<string, unknown>;
  createdAt: string;
}

/**
 * A gesture tapped and not yet handed to the API nor to the queue: what the
 * queue needs to send it. Written to disk with the tap, so a process killed
 * while it waits for the GPS or for the API leaves it behind and the next
 * start queues it. Its key was made at the tap: a gesture that did reach the
 * API before the kill is only replayed.
 */
interface PauseHandoff {
  submissionId: string;
  kind: PauseOutboxKind;
  businessId: string;
  ownerUserId: string;
  endpoint: string;
  body: Record<string, unknown>;
  vehicleLabel: string;
}

/** The queue key a pause is kept under: one driver, one company. */
function pauseScope(userId: string, businessId: string): string {
  return `${userId}:${businessId}`;
}

/** This driver's pause gestures for this company still in the queue, in queue order. */
function queuedPauseItems<T extends QueuedPauseItem>(
  items: readonly T[],
  owner: { ownerUserId: string; businessId: string },
): T[] {
  return items.filter(
    (item) =>
      isPauseOutboxKind(item.kind) &&
      item.businessId === owner.businessId &&
      item.ownerUserId === owner.ownerUserId,
  );
}

/**
 * Still on its way: pending, or parked until Entregas comes back. A failed
 * item is not: it needs a person and says nothing reached the server, so
 * every rule here reads it the same way.
 */
const waiting = (item: QueuedPauseItem): boolean =>
  item.status === "pending" || item.status === "parked";

/**
 * Whether a new gesture must go behind the queue instead of straight out.
 *
 * Pause gestures are sent in the order they were tapped. A start sent past an
 * end still waiting in the queue meets the old pause open on the server (409
 * PAUSE_ALREADY_OPEN) — the contract's "Ordem na fila". A failed item is not
 * waited on: holding every later gesture behind it would freeze the pause
 * forever.
 */
function mustQueueBehind(queued: readonly QueuedPauseItem[]): boolean {
  return queued.some(waiting);
}

/**
 * The toast's second line for a gesture queued only to keep the order: the
 * phone may well be online, so "quando houver conexão" would be wrong.
 */
const PAUSE_QUEUED_BEHIND_NOTICE =
  "Segue logo depois do registro de pausa anterior, que ainda está na fila.";

const startKeyOf = (item: QueuedPauseItem): string | null => {
  const key = item.body.start_submission_id;

  return typeof key === "string" ? key : null;
};

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * The open pause as the queue alone tells it: among the gestures still on
 * their way, the last start whose own end is not queued. A fallback for a
 * phone whose local record is missing while the queue still holds the
 * gestures (the queue survives what a store may not).
 */
function openPauseFromQueue(queued: readonly QueuedPauseItem[]): OpenPause | null {
  const onTheirWay = queued.filter(waiting);

  const ended = new Set(
    onTheirWay
      .filter((item) => item.kind === PAUSE_END_KIND)
      .map(startKeyOf)
      .filter((key): key is string => key !== null),
  );

  for (let index = onTheirWay.length - 1; index >= 0; index -= 1) {
    const item = onTheirWay[index];
    if (item.kind === PAUSE_END_KIND) return null;

    const key = startKeyOf(item);
    if (item.kind !== PAUSE_START_KIND || !key || ended.has(key)) continue;
    if (!isPauseKind(item.body.kind)) continue;

    return {
      startSubmissionId: key,
      kind: item.body.kind,
      startedAt: asText(item.body.occurred_at) ?? item.createdAt,
      note: asText(item.body.note),
      latitude: asNumber(item.body.latitude),
      longitude: asNumber(item.body.longitude),
    };
  }

  return null;
}

interface ResolvePauseInput {
  local: LocalPauseState | null;
  server: ServerPauseSnapshot | null;

  /** This driver's pause gestures for this company still in the queue. */
  queued: readonly QueuedPauseItem[];

  /**
   * A gesture is being handed over: tapped, not yet sent nor queued. In
   * memory while this process sends it, or left on disk by a process killed
   * mid-handoff until the next start queues it (`PauseHandoff`).
   */
  sending: boolean;
}

type PauseSource = "local" | "queue" | "server" | "none";

interface ResolvedPause {
  open: OpenPause | null;
  source: PauseSource;
}

/**
 * Whether the driver is on a pause, and whose word that is.
 *
 * - While a gesture is being handed over or still waits in the queue, the
 *   phone wins: the server does not know yet what the driver tapped
 *   (contract: "o estado local vence"). A FAILED item does not count: it
 *   never reached the server, and holding the screen on it would hide the
 *   server's pause until someone discards the card.
 * - Otherwise the server wins, but only with an answer ASKED AFTER the
 *   record's `changedAt`: the last tap, and also the moment the last gesture
 *   was settled with the server (`settledPauseState`). An answer asked before
 *   that describes a world the gesture had not reached yet; adopting it would
 *   take a pause just started off screen, or bring an ended one back.
 * - With neither, the phone's record, and nothing at all is "no pause".
 */
function resolvePause({ local, server, queued, sending }: ResolvePauseInput): ResolvedPause {
  const phoneWins = sending || queued.some(waiting);

  if (phoneWins) {
    if (local) return { open: local.open, source: "local" };

    return { open: openPauseFromQueue(queued), source: "queue" };
  }

  if (server && (!local || server.requestedAt > local.changedAt)) {
    // The same pause the phone tapped keeps the phone's start: the timer
    // counts on the phone's clock, and the server's `started_at` is on the
    // server's — a phone five minutes fast would show five minutes too many.
    const open =
      server.open && local?.open && samePause(server.open, local.open)
        ? local.open
        : server.open;

    return { open, source: "server" };
  }

  if (local) return { open: local.open, source: "local" };

  return { open: null, source: "none" };
}

/** The same pause: the same start key, whoever reports it. */
const samePause = (left: OpenPause | null, right: OpenPause | null): boolean =>
  (left?.startSubmissionId ?? null) === (right?.startSubmissionId ?? null);

/**
 * Whether the phone's record should take the server's answer, so the next
 * cold start offline shows what the server said (a pause ended from another
 * install, a pause started there). Only when the server is the one that won.
 */
function shouldAdoptServer(input: ResolvePauseInput): boolean {
  const resolved = resolvePause(input);

  if (resolved.source !== "server" || !input.server) return false;

  return !input.local || !samePause(input.local.open, input.server.open);
}

/**
 * The phone's record once one of its gestures is settled with the server
 * (landed, or dropped on a final refusal). The pause shown does not change,
 * but `changedAt` moves to now, so no `/current` answer asked while the
 * gesture was still on its way can win once the queue lets go of it
 * (`resolvePause`). With no record at all, the queue's word is written down.
 */
function settledPauseState(
  local: LocalPauseState | null,
  fromQueue: OpenPause | null,
  at: number,
): LocalPauseState {
  return {
    open: local ? local.open : fromQueue,
    changedAt: Math.max(at, local?.changedAt ?? 0),
  };
}

/** Whether "Iniciar pausa" may be offered: one open pause at a time. */
function canStartPause(resolved: ResolvedPause): boolean {
  return resolved.open === null;
}

/**
 * Whether this pause's start is still only on the phone, for "salva no
 * aparelho" under the timer.
 */
function isStartQueued(
  open: OpenPause | null,
  queued: readonly QueuedPauseItem[],
): boolean {
  if (!open) return false;

  return queued.some(
    (item) =>
      item.kind === PAUSE_START_KIND &&
      startKeyOf(item) === open.startSubmissionId,
  );
}

/**
 * The note as the API stores it: one line, no spaces at the ends or in runs,
 * empty is none (the API's `normalizePauseNote`). Cleaned, never refused.
 */
function normalizePauseNote(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const cleaned = raw.replace(/\s+/g, " ").trim();

  return cleaned.length > 0 ? cleaned : null;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

/** A position the API reads as one, or nothing: never half a pair. */
const coordinatesOf = (
  coordinates:
    | { latitude?: number | null; longitude?: number | null }
    | null
    | undefined,
): Partial<Coordinates> => {
  const latitude = asNumber(coordinates?.latitude);
  const longitude = asNumber(coordinates?.longitude);

  return latitude !== null && longitude !== null ? { latitude, longitude } : {};
};

interface StartPauseInput {
  startSubmissionId: string;
  kind: PauseKind;
  /** Decision 14.4 (contract 3): the company's pause type chosen. */
  occurrenceTypeId?: string | null;
  occurredAt: string;
  note?: string | null;
  coordinates?: Coordinates | null;
}

/** `POST /driver-pause/start/:businessId` */
function startPauseBody(input: StartPauseInput): Record<string, unknown> {
  const note = normalizePauseNote(input.note);

  return {
    kind: input.kind,
    ...(input.occurrenceTypeId ? { occurrence_type_id: input.occurrenceTypeId } : {}),
    start_submission_id: input.startSubmissionId,
    occurred_at: input.occurredAt,
    ...coordinatesOf(input.coordinates),
    ...(note ? { note } : {}),
  };
}

interface EndPauseInput {
  endSubmissionId: string;
  occurredAt: string;
  coordinates?: Coordinates | null;
}

/**
 * `POST /driver-pause/end/:businessId`, always carrying the start repeated.
 *
 * The queue moves on past a failed item, so an end can reach the API before
 * its start; with `start` the API creates the pause already closed, and the
 * late start finds it (contract: "start torna o fim autossuficiente").
 */
function endPauseBody(open: OpenPause, input: EndPauseInput): Record<string, unknown> {
  return {
    start_submission_id: open.startSubmissionId,
    end_submission_id: input.endSubmissionId,
    occurred_at: input.occurredAt,
    ...coordinatesOf(input.coordinates),
    start: {
      kind: open.kind,
      ...(open.occurrenceTypeId ? { occurrence_type_id: open.occurrenceTypeId } : {}),
      occurred_at: open.startedAt,
      ...coordinatesOf(open),
      ...(open.note ? { note: open.note } : {}),
    },
  };
}

/** The pause as `GET /driver-pause/current` serves it, or null when unreadable. */
function openPauseFromServer(raw: unknown): OpenPause | null {
  if (!raw || typeof raw !== "object") return null;

  const pause = raw as Record<string, unknown>;
  const key = asText(pause.start_submission_id);
  const startedAt = asText(pause.started_at);

  if (!key || !startedAt || !isPauseKind(pause.kind)) return null;
  if (Number.isNaN(Date.parse(startedAt))) return null;

  const type =
    pause.occurrence_type && typeof pause.occurrence_type === "object"
      ? (pause.occurrence_type as Record<string, unknown>)
      : null;

  return {
    startSubmissionId: key,
    kind: pause.kind,
    startedAt,
    note: asText(pause.note),
    latitude: asNumber(pause.start_latitude),
    longitude: asNumber(pause.start_longitude),
    ...(type && asText(type.id)
      ? { occurrenceTypeId: asText(type.id), typeName: asText(type.name) }
      : {}),
  };
}

/**
 * Reads the `/current` answer. Undefined when the shape is not understood, so
 * a malformed answer is ignored rather than read as "no pause" — which would
 * take a real pause off the driver's screen.
 */
function currentPauseFromResponse(response: unknown): OpenPause | null | undefined {
  if (!response || typeof response !== "object" || !("open" in response)) {
    return undefined;
  }

  const open = (response as { open: unknown }).open;
  if (open === null) return null;

  return openPauseFromServer(open) ?? undefined;
}

/**
 * How a refusal ends a queued pause gesture, beyond "failed" (the contract's
 * error table). Null leaves the queue's own classification in charge.
 *
 * - `settled`: nothing more to send, and nothing to show the driver.
 * - `retry`: not a verdict yet — the order of the queue will fix it.
 */
type PauseSettleReason =
  | "too-old"
  | "already-ended"
  | "merged-into-end"
  | "other-pause-open"
  // Decision 14.4: no route released or in progress at the tap; nothing was
  // recorded (a start, or an end that would have created the pause).
  | "requires-route";

type PauseRefusalVerdict =
  | { outcome: "settled"; reason: PauseSettleReason }
  | { outcome: "retry" }
  | null;

function pauseRefusalVerdict(
  item: QueuedPauseItem,
  code: string | null | undefined,
  queue: readonly QueuedPauseItem[],
): PauseRefusalVerdict {
  if (!isPauseOutboxKind(item.kind) || !code) return null;

  // Nothing was recorded, and it never will be: a gesture beyond the offline
  // horizon. Dropped without a red card; the screen rereads the server.
  if (code === "PAUSE_TOO_OLD") return { outcome: "settled", reason: "too-old" };

  // Outside a journey nothing was recorded either, for a start or for the
  // end that would have created the pause. Dropped without a red card; the
  // phone forgets that pause and tells the driver why (contract 3).
  if (code === "PAUSE_REQUIRES_ROUTE") {
    return { outcome: "settled", reason: "requires-route" };
  }

  if (item.kind === PAUSE_END_KIND) {
    return code === "PAUSE_ALREADY_ENDED"
      ? { outcome: "settled", reason: "already-ended" }
      : null;
  }

  if (code !== "PAUSE_ALREADY_OPEN") return null;

  const mine = queuedPauseItems(queue, {
    ownerUserId: item.ownerUserId ?? "",
    businessId: item.businessId,
  });
  const key = startKeyOf(item);

  // Its own end is still queued and carries `start`: that end creates this
  // pause already closed, so this start has nothing left to do.
  const ownEndQueued = mine.some(
    (other) =>
      other.kind === PAUSE_END_KIND && startKeyOf(other) === key && waiting(other),
  );

  if (ownEndQueued) return { outcome: "settled", reason: "merged-into-end" };

  // The pause open on the server is an older one whose end is still behind in
  // the queue: once that end lands, this start goes through.
  const position = mine.findIndex((other) => other.id === item.id);
  const earlierEndWaiting = mine.some(
    (other, index) =>
      other.kind === PAUSE_END_KIND &&
      waiting(other) &&
      (position === -1 || index < position),
  );

  if (earlierEndWaiting) return { outcome: "retry" };

  // Another pause is open that this phone never tapped (another install):
  // the screen shows the server's pause instead of a red card.
  return { outcome: "settled", reason: "other-pause-open" };
}

/** "12:05", "1:02:03": the running timer, counted from the start. */
function formatPauseElapsed(startedAt: string, now: number): string {
  const started = Date.parse(startedAt);
  const totalSeconds = Number.isNaN(started)
    ? 0
    : Math.max(0, Math.floor((now - started) / 1000));

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const two = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${two(minutes)}:${two(seconds)}`
    : `${two(minutes)}:${two(seconds)}`;
}

/** "42 min", "1 h 05 min": how long a pause lasted, for the end's toast. */
function formatPauseDuration(startedAt: string, endedAt: number): string {
  const started = Date.parse(startedAt);
  const minutes = Number.isNaN(started)
    ? 0
    : Math.max(0, Math.floor((endedAt - started) / 60_000));

  if (minutes < 60) return `${minutes} min`;

  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export {
  PAUSE_END_KIND,
  PAUSE_KINDS,
  PAUSE_KIND_OPTIONS,
  PAUSE_NOTE_MAX_LENGTH,
  PAUSE_QUEUED_BEHIND_NOTICE,
  PAUSE_REQUIRES_ROUTE_NOTICE,
  PAUSE_START_KIND,
  canStartPause,
  isPauseAllowed,
  openPauseTitle,
  pauseChoicesOf,
  currentPauseFromResponse,
  endPauseBody,
  formatPauseDuration,
  formatPauseElapsed,
  isPauseKind,
  isPauseOutboxKind,
  isStartQueued,
  mustQueueBehind,
  normalizePauseNote,
  openPauseFromQueue,
  openPauseFromServer,
  pauseRefusalVerdict,
  pauseScope,
  pauseTitle,
  queuedPauseItems,
  resolvePause,
  settledPauseState,
  shouldAdoptServer,
  startPauseBody,
};

export type {
  JourneyCache,
  LocalPauseState,
  OpenPause,
  PauseChoice,
  PauseHandoff,
  PauseKind,
  PauseOutboxKind,
  PauseRefusalVerdict,
  PauseSettleReason,
  PauseSource,
  QueuedPauseItem,
  ResolvePauseInput,
  ResolvedPause,
  ServerPauseSnapshot,
};
