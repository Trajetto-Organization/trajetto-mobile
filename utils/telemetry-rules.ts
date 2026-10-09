import { truncateText } from "./truncate-text";
/**
 * What the app may say about its own failures, and how often.
 *
 * Pure and import-free, like the other rule modules: whatever leaves the phone
 * goes through here first, so the two properties that matter — no personal
 * data, no flood — can be tested without a network or a vendor SDK.
 */

type TelemetryEventName =
  // A queued submission refused for good, or stuck retrying.
  | "outbox_item_failed"

  // The API refused a refresh: reuse, revocation, an expired family.
  | "refresh_rejected"

  // The API refused a socket handshake (not a network failure).
  | "socket_refused"

  // Anything the code already reports through `logger.error`.
  | "app_error"

  // An uncaught JavaScript error.
  | "js_error"

  // The phone's offline pre-check could not read a photo (decision 14.2).
  // Only the failure goes: never the text read.
  | "ai_precheck_failed";

type TelemetryTags = Record<string, string | number | boolean | undefined>;

interface TelemetryEvent {
  name: TelemetryEventName;
  tags: TelemetryTags;
  at: number;
}

const REDACTED = "[redacted]";

// Longest text any report carries: enough to recognise the failure, too short
// to carry a request body.
const MAX_TEXT_LENGTH = 300;

/**
 * Order matters: the URL rule runs first so a signature inside a query string
 * is gone before the narrower rules look at what is left.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Query strings: presigned PUT URLs carry their signature there.
  /(https?:\/\/[^\s?#]+)\?[^\s#]*/gi,

  /\bBearer\s+[\w.~+/=-]+/gi,

  // A JWT anywhere, with or without the Bearer prefix.
  /\beyJ[\w-]*\.[\w-]+\.[\w-]+/g,

  /ExponentPushToken\[[^\]]*\]/g,

  // E-mail addresses.
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,

  // CPF, formatted or not.
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
];

function scrubText(text: string): string {
  let scrubbed = text;

  for (const pattern of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, (match, url?: string) =>
      typeof url === "string" && match.startsWith(url)
        ? `${url}?${REDACTED}`
        : REDACTED,
    );
  }

  return scrubbed.length > MAX_TEXT_LENGTH
    ? truncateText(scrubbed, MAX_TEXT_LENGTH)
    : scrubbed;
}

function scrubTags(tags: TelemetryTags): TelemetryTags {
  return Object.fromEntries(
    Object.entries(tags)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? scrubText(value) : value,
      ]),
  );
}

/**
 * One report per kind of failure per window.
 *
 * The failures worth reporting are the ones that repeat: a queue retrying the
 * same refused proof, a socket refused on every handshake. Without this the
 * first bad deploy would make every phone report every attempt.
 */
const REPORT_WINDOW_MS = 10 * 60_000;

function createReportThrottle(
  windowMs: number = REPORT_WINDOW_MS,
): (key: string, now: number) => boolean {
  const lastReported = new Map<string, number>();

  return (key, now) => {
    const last = lastReported.get(key);
    if (last !== undefined && now - last < windowMs) return false;

    lastReported.set(key, now);
    return true;
  };
}

/** What makes two reports "the same failure". */
function throttleKey(name: TelemetryEventName, tags: TelemetryTags): string {
  return [name, tags.code, tags.kind, tags.failure, tags.where]
    .map((part) => (part === undefined ? "" : String(part)))
    .join("|");
}

export {
  REPORT_WINDOW_MS,
  createReportThrottle,
  scrubTags,
  scrubText,
  throttleKey,
};

export type { TelemetryEvent, TelemetryEventName, TelemetryTags };
