import type { TelemetryEvent } from "@/utils/telemetry-rules";

import {
  toClientReport,
  type ClientReport,
  type OutboxSummary,
} from "./client-report-rules";

/**
 * The telemetry sink that sends the app's failures to the API (OBS-12, the
 * remote end MOB-10 left open).
 *
 * Built from injected pieces so the timing rules are testable without a
 * network or a native module; `install-diagnostics.ts` wires the real ones.
 *
 *  - Events are buffered and sent together a few seconds later, never more
 *    often than MIN_INTERVAL_MS: at most a dozen reports an hour, well inside
 *    the API's 30 per user.
 *  - No session, no send: the batch waits. A report must never be the request
 *    that trips a refresh or a logout.
 *  - An API without the endpoint (404: an older API while the app rolls out
 *    first) switches the reporter off for this run of the app.
 *  - Events raised WHILE a report is in flight are the report's own echo (the
 *    HTTP client logging its failure) and are dropped.
 *  - Nothing here throws into the caller: reporting a failure must not become
 *    one.
 */
const MIN_INTERVAL_MS = 5 * 60_000;
const SEND_DELAY_MS = 15_000;
const MAX_BUFFERED = 50;

interface DiagnosticsReporterDeps {
  send: (report: ClientReport) => Promise<unknown>;
  canSend: () => Promise<boolean>;
  context: () => { platform?: string; appVersion?: string };
  summarizeQueue: () => Promise<OutboxSummary | undefined>;
  now?: () => number;
  schedule?: (run: () => void, delayMs: number) => void;
  minIntervalMs?: number;
  delayMs?: number;
}

interface DiagnosticsReporter {
  onEvent: (event: TelemetryEvent) => void;

  /** Settles when the flush in progress (if any) is done. For tests. */
  idle: () => Promise<void>;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;

  return typeof status === "number" ? status : undefined;
}

function createDiagnosticsReporter(deps: DiagnosticsReporterDeps): DiagnosticsReporter {
  const now = deps.now ?? (() => Date.now());
  const schedule =
    deps.schedule ??
    ((run: () => void, delayMs: number) => {
      setTimeout(run, delayMs);
    });
  const minInterval = deps.minIntervalMs ?? MIN_INTERVAL_MS;
  const delay = deps.delayMs ?? SEND_DELAY_MS;

  let buffer: TelemetryEvent[] = [];
  let scheduled = false;
  let sending = false;
  let disabled = false;
  let lastSentAt: number | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const ensureScheduled = (waitMs?: number): void => {
    if (scheduled || disabled) return;

    scheduled = true;

    const wait =
      waitMs ??
      (lastSentAt === null
        ? delay
        : Math.max(delay, lastSentAt + minInterval - now()));

    schedule(() => {
      scheduled = false;
      inFlight = flush().catch(() => undefined);
    }, wait);
  };

  const flush = async (): Promise<void> => {
    if (disabled || buffer.length === 0) return;

    if (lastSentAt !== null && now() - lastSentAt < minInterval) {
      ensureScheduled();
      return;
    }

    if (!(await deps.canSend().catch(() => false))) {
      // Try again after a full interval, not in a loop.
      ensureScheduled(minInterval);
      return;
    }

    const batch = buffer;
    buffer = [];

    sending = true;

    try {
      const outbox = await deps.summarizeQueue().catch(() => undefined);

      await deps.send(toClientReport(batch, { ...deps.context(), outbox }));
    } catch (error) {
      const status = statusOf(error);

      if (status === 404) {
        disabled = true;
        buffer = [];
        return;
      }

      // A report the API refused as malformed would be refused again, the
      // same way, every few minutes: dropped. Anything else (no network, a
      // 5xx, a 429) is kept for the next report, oldest dropped past the cap.
      if (status !== 400 && status !== 413) {
        buffer = [...batch, ...buffer].slice(-MAX_BUFFERED);
      }
    } finally {
      sending = false;
      lastSentAt = now();
    }

    if (buffer.length > 0) ensureScheduled();
  };

  return {
    onEvent: (event) => {
      try {
        if (disabled || sending) return;

        buffer.push(event);
        if (buffer.length > MAX_BUFFERED) buffer.shift();

        ensureScheduled();
      } catch {
        // Never the app's problem.
      }
    },
    idle: () => inFlight,
  };
}

export { MIN_INTERVAL_MS, createDiagnosticsReporter };
export type { DiagnosticsReporter, DiagnosticsReporterDeps };
