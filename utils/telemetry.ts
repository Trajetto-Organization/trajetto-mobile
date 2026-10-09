import {
  createReportThrottle,
  scrubTags,
  throttleKey,
  type TelemetryEvent,
  type TelemetryEventName,
  type TelemetryTags,
} from "./telemetry-rules";

/**
 * The one door through which the app's failures leave the phone.
 *
 * The logger wrote to the device console and nowhere else, so a dropped queue
 * file, a refresh refused as reuse or a socket refused on every handshake
 * reached the operation only as a driver's complaint. Every such signal now
 * comes through here, scrubbed and throttled (`telemetry-rules`).
 *
 * WHERE it goes is a sink, set once at startup — a crash-reporting SDK, or the
 * API's diagnostics endpoint. Until one is set, events stay in a small buffer
 * a diagnostics screen or report can read. This module imports nothing but
 * the rules, so the logger, the HTTP client and the socket can all use it.
 */
type TelemetrySink = (event: TelemetryEvent) => void;

let sink: TelemetrySink | null = null;

const RECENT_LIMIT = 50;
const recent: TelemetryEvent[] = [];

const shouldReport = createReportThrottle();

function setTelemetrySink(next: TelemetrySink | null): void {
  sink = next;
}

/** Never throws: reporting a failure must not become one. */
function reportEvent(name: TelemetryEventName, tags: TelemetryTags = {}): void {
  try {
    const now = Date.now();
    if (!shouldReport(throttleKey(name, tags), now)) return;

    const event: TelemetryEvent = { name, tags: scrubTags(tags), at: now };

    recent.push(event);
    if (recent.length > RECENT_LIMIT) recent.shift();

    sink?.(event);
  } catch {
    // A broken sink is not the app's problem.
  }
}

/** The latest events, oldest first, for a diagnostics report. */
function getRecentTelemetry(): TelemetryEvent[] {
  return [...recent];
}

interface GlobalErrorUtils {
  getGlobalHandler: () => ((error: Error, isFatal?: boolean) => void) | undefined;
  setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
}

let globalHandlerInstalled = false;

/**
 * Records uncaught JavaScript errors, then hands them to React Native's own
 * handler exactly as before (red box in development, crash in release).
 */
function installGlobalErrorHandler(): void {
  if (globalHandlerInstalled) return;

  const errorUtils = (globalThis as { ErrorUtils?: GlobalErrorUtils })
    .ErrorUtils;
  if (!errorUtils) return;

  globalHandlerInstalled = true;
  const previous = errorUtils.getGlobalHandler();

  errorUtils.setGlobalHandler((error, isFatal) => {
    reportEvent("js_error", {
      code: error?.name ?? "Error",
      fatal: Boolean(isFatal),
      where: error?.message,
    });

    previous?.(error, isFatal);
  });
}

export {
  getRecentTelemetry,
  installGlobalErrorHandler,
  reportEvent,
  setTelemetrySink,
};

export type { TelemetrySink };
