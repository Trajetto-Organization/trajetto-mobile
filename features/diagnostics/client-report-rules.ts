import type { TelemetryEvent } from "@/utils/telemetry-rules";
import { truncateText } from "@/utils/truncate-text";

/**
 * What the app tells the API about failures only it can see (OBS-12), and in
 * what shape. Pure and import-free (the type import is erased), like the other
 * rule modules, so the bounds the API enforces are proven here without a
 * network.
 *
 * The contract is POST /diagnostics/client: a summary, never content. The
 * telemetry events were already scrubbed (`telemetry-rules.scrubTags`); this
 * only groups them and keeps every field inside the API's limits, so a report
 * is never refused for being too long.
 */

type ClientPlatform = "android" | "ios" | "web";

type ClientErrorKind = "upload" | "api" | "network" | "unknown";

interface ClientReportError {
  kind: ClientErrorKind;
  event?: string;
  code?: string;
  status?: number;
  host?: string;
  message: string;
  count: number;
}

interface OutboxSummary {
  pending: number;
  failed: number;
  stuck: number;
  oldestAgeSec: number;
}

interface ClientReport {
  platform: ClientPlatform;
  appVersion?: string;
  outbox?: OutboxSummary;
  errors: ClientReportError[];
}

/** The API's bounds (trajetto-api diagnostics-documentation.ts). */
const MAX_ERRORS = 10;
const MAX_MESSAGE = 200;
const MAX_APP_VERSION = 120;
const MAX_CODE = 60;
const MAX_HOST = 100;
const MAX_COUNTER = 1_000_000_000;

/**
 * A pending item is stuck after this many attempts, or this long in line.
 * Three is when the queue itself starts telling the telemetry (outbox.ts);
 * thirty minutes is two full turns of the 15-minute backoff ceiling.
 */
const STUCK_ATTEMPTS = 3;
const STUCK_AGE_MS = 30 * 60_000;

/**
 * The host of a URL and nothing else. A presigned PUT URL carries its
 * signature in the query: the host is what tells R2 from the local stand-in,
 * the rest must never leave the phone.
 */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;

  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:@]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);

  return match ? match[1].toLowerCase().slice(0, MAX_HOST) : undefined;
}

interface SummarizableItem {
  status: string;
  attempts: number;
  createdAt: string;
}

/**
 * The offline queue in four numbers. Parked items wait for a module to be
 * switched back on — waiting, not stuck — and are left out.
 */
function summarizeOutbox(items: SummarizableItem[], now: number): OutboxSummary {
  let pending = 0;
  let failed = 0;
  let stuck = 0;
  let oldest = now;

  for (const item of items) {
    if (item.status === "failed") {
      failed += 1;
      continue;
    }

    if (item.status !== "pending") continue;

    pending += 1;

    const created = Date.parse(item.createdAt);
    const age = Number.isFinite(created) ? now - created : 0;

    if (item.attempts >= STUCK_ATTEMPTS || age >= STUCK_AGE_MS) stuck += 1;
    if (Number.isFinite(created) && created < oldest) oldest = created;
  }

  return {
    pending,
    failed,
    stuck,
    // Clamped to the API's bound: a report refused for its size is retried
    // with the same body forever.
    oldestAgeSec: Math.min(
      MAX_COUNTER,
      Math.max(0, Math.round((now - oldest) / 1000)),
    ),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function kindOf(event: TelemetryEvent): ClientErrorKind {
  switch (event.name) {
    case "outbox_item_failed":
      if (event.tags.source === "upload") return "upload";
      if (event.tags.category === "NETWORK" || event.tags.category === "TIMEOUT") {
        return "network";
      }
      return event.tags.source === "api" ? "api" : "unknown";
    case "refresh_rejected":
    case "socket_refused":
      return "api";
    default:
      return "unknown";
  }
}

function messageOf(event: TelemetryEvent): string {
  const where = text(event.tags.where);

  if (event.name === "outbox_item_failed") {
    const what = `${text(event.tags.kind) ?? "item"} (${text(event.tags.failure) ?? "?"})`;

    return where ? `${what}: ${where}` : what;
  }

  return where ?? event.name;
}

function toError(event: TelemetryEvent): ClientReportError {
  const code = text(event.tags.code)?.slice(0, MAX_CODE);
  const status =
    typeof event.tags.status === "number" &&
    Number.isInteger(event.tags.status) &&
    event.tags.status >= 100 &&
    event.tags.status <= 599
      ? event.tags.status
      : undefined;
  const host = text(event.tags.host)?.slice(0, MAX_HOST);

  return {
    kind: kindOf(event),
    event: event.name,
    ...(code ? { code } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(host ? { host } : {}),
    message: truncateText(messageOf(event), MAX_MESSAGE),
    count: 1,
  };
}

function platformOf(platform: string | undefined): ClientPlatform {
  return platform === "ios" || platform === "web" ? platform : "android";
}

/**
 * The report for a batch of events: the same failure counted, not repeated,
 * in the order each first happened, at most ten kinds.
 */
function toClientReport(
  events: TelemetryEvent[],
  context: { platform?: string; appVersion?: string; outbox?: OutboxSummary },
): ClientReport {
  const grouped = new Map<string, ClientReportError>();

  for (const event of events) {
    const error = toError(event);
    const key = [
      error.event,
      error.kind,
      error.code,
      error.status,
      error.host,
      error.message,
    ].join("|");

    const existing = grouped.get(key);

    if (existing) {
      existing.count += 1;
    } else if (grouped.size < MAX_ERRORS) {
      grouped.set(key, error);
    }
  }

  const appVersion = text(context.appVersion)?.slice(0, MAX_APP_VERSION);

  return {
    platform: platformOf(context.platform),
    ...(appVersion ? { appVersion } : {}),
    ...(context.outbox ? { outbox: context.outbox } : {}),
    errors: [...grouped.values()],
  };
}

export { STUCK_AGE_MS, STUCK_ATTEMPTS, hostOf, summarizeOutbox, toClientReport };
export type {
  ClientPlatform,
  ClientReport,
  ClientReportError,
  OutboxSummary,
};
