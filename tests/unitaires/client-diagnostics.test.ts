import { describe, expect, it, vi } from "vitest";

import {
  hostOf,
  summarizeOutbox,
  toClientReport,
} from "@/features/diagnostics/client-report-rules";
import { createDiagnosticsReporter } from "@/features/diagnostics/diagnostics-reporter";
import { ApiError } from "@/utils/api-error";
import type { TelemetryEvent } from "@/utils/telemetry-rules";

/**
 * OBS-12: nothing a phone saw ever left it. The logger wrote to the device
 * console; a photo whose PUT the bucket refused kept its item pending, in
 * silence, forever; the telemetry pipeline (MOB-10) scrubbed and throttled
 * every failure and then had nowhere to send it. The operation learned about a
 * broken bucket credential when a customer asked for a proof.
 *
 * The reporter is that nowhere's end: telemetry events, plus a summary of the
 * offline queue, go to POST /diagnostics/client — summarised, bounded,
 * never more often than every few minutes, and never at the cost of the app.
 */
const NOW = Date.parse("2026-09-24T12:00:00Z");
const MINUTE = 60_000;

function event(
  name: TelemetryEvent["name"],
  tags: TelemetryEvent["tags"] = {},
  at = NOW,
): TelemetryEvent {
  return { name, tags, at };
}

describe("the host of a signed URL", () => {
  it("is all that is kept of it: no path, no signature", () => {
    expect(
      hostOf(
        "https://acc.r2.cloudflarestorage.com/trajetto/deliveryPhotos/b/1.jpg?X-Amz-Signature=abc",
      ),
    ).toBe("acc.r2.cloudflarestorage.com");
  });

  it("is nothing for something that is not a URL", () => {
    expect(hostOf("não é url")).toBeUndefined();
    expect(hostOf(undefined)).toBeUndefined();
  });
});

describe("the queue summary", () => {
  const item = (overrides: Record<string, unknown>) => ({
    status: "pending",
    attempts: 0,
    createdAt: new Date(NOW - MINUTE).toISOString(),
    ...overrides,
  });

  it("counts what waits, what gave up, and what is stuck", () => {
    expect(
      summarizeOutbox(
        [
          item({}),
          // Retried three times already: the PUT keeps being refused.
          item({ attempts: 3 }),
          // Queued an hour ago and still here.
          item({ createdAt: new Date(NOW - 60 * MINUTE).toISOString() }),
          item({ status: "failed", attempts: 1 }),
          // Parked waits for a module to be switched back on: not stuck.
          item({ status: "parked", createdAt: new Date(NOW - 120 * MINUTE).toISOString() }),
        ],
        NOW,
      ),
    ).toEqual({ pending: 3, failed: 1, stuck: 2, oldestAgeSec: 3_600 });
  });

  it("is all zeros for an empty queue", () => {
    expect(summarizeOutbox([], NOW)).toEqual({
      pending: 0,
      failed: 0,
      stuck: 0,
      oldestAgeSec: 0,
    });
  });
});

describe("the report sent to the API", () => {
  it("groups repeated failures and says what kind each one is", () => {
    const report = toClientReport(
      [
        event("outbox_item_failed", {
          source: "upload",
          status: 403,
          host: "acc.r2.cloudflarestorage.com",
          kind: "delivery-proof",
          failure: "transient",
          where: "Falha ao enviar uma das fotos.",
        }),
        event("outbox_item_failed", {
          source: "upload",
          status: 403,
          host: "acc.r2.cloudflarestorage.com",
          kind: "delivery-proof",
          failure: "transient",
          where: "Falha ao enviar uma das fotos.",
        }),
        event("refresh_rejected", { code: "AUTH_REFRESH_REUSED", status: 401 }),
        event("js_error", { code: "TypeError", where: "x is undefined" }),
      ],
      { platform: "android", appVersion: "1.8.0/45/1.0.0/embedded/3" },
    );

    expect(report.platform).toBe("android");
    expect(report.appVersion).toBe("1.8.0/45/1.0.0/embedded/3");
    expect(report.errors).toEqual([
      {
        kind: "upload",
        event: "outbox_item_failed",
        status: 403,
        host: "acc.r2.cloudflarestorage.com",
        message: "delivery-proof (transient): Falha ao enviar uma das fotos.",
        count: 2,
      },
      {
        kind: "api",
        event: "refresh_rejected",
        code: "AUTH_REFRESH_REUSED",
        status: 401,
        message: "refresh_rejected",
        count: 1,
      },
      {
        kind: "unknown",
        event: "js_error",
        code: "TypeError",
        message: "x is undefined",
        count: 1,
      },
    ]);
  });

  it("stays inside the bounds the API accepts", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      event("app_error", { where: `${index} ${"x".repeat(400)}` }),
    );

    const report = toClientReport(many, {
      platform: "ios",
      appVersion: "v".repeat(300),
    });

    expect(report.errors).toHaveLength(10);
    expect(report.errors.every((error) => error.message.length <= 200)).toBe(true);
    expect(report.appVersion?.length).toBeLessThanOrEqual(120);
  });
});

describe("the reporter", () => {
  function setup(overrides: { canSend?: () => Promise<boolean> } = {}) {
    let clock = NOW;
    const send = vi.fn(async (_body: unknown) => undefined);
    const timers: Array<() => void> = [];

    const reporter = createDiagnosticsReporter({
      send,
      canSend: overrides.canSend ?? (async () => true),
      context: () => ({ platform: "android", appVersion: "1.8.0" }),
      summarizeQueue: async () => ({ pending: 1, failed: 0, stuck: 1, oldestAgeSec: 5_400 }),
      now: () => clock,
      schedule: (run) => {
        timers.push(run);
      },
    });

    return {
      reporter,
      send,
      advance: (ms: number) => {
        clock += ms;
      },
      runTimers: async () => {
        const pending = timers.splice(0);
        for (const run of pending) run();
        await reporter.idle();
      },
    };
  }

  it("sends buffered events as one report, with the queue summary", async () => {
    const { reporter, send, runTimers } = setup();

    reporter.onEvent(event("outbox_item_failed", { source: "upload", status: 403 }));
    reporter.onEvent(event("socket_refused", { code: "AUTH_TOKEN_INVALID" }));

    await runTimers();

    expect(send).toHaveBeenCalledTimes(1);

    const body = send.mock.calls[0][0] as ReturnType<typeof toClientReport>;
    expect(body.errors).toHaveLength(2);
    expect(body.outbox).toEqual({ pending: 1, failed: 0, stuck: 1, oldestAgeSec: 5_400 });
  });

  it("never reports more often than its interval", async () => {
    const { reporter, send, runTimers, advance } = setup();

    reporter.onEvent(event("app_error", { where: "a" }));
    await runTimers();

    advance(MINUTE);
    reporter.onEvent(event("app_error", { where: "b" }));
    await runTimers();

    expect(send).toHaveBeenCalledTimes(1);

    // Kept, and sent once the interval has passed.
    advance(10 * MINUTE);
    await runTimers();

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits for a session instead of sending without one", async () => {
    let signedIn = false;
    const { reporter, send, runTimers, advance } = setup({
      canSend: async () => signedIn,
    });

    reporter.onEvent(event("app_error", { where: "a" }));
    await runTimers();

    expect(send).not.toHaveBeenCalled();

    signedIn = true;
    advance(10 * MINUTE);
    await runTimers();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops for good against an API that does not have the endpoint", async () => {
    const { reporter, send, runTimers, advance } = setup();

    send.mockRejectedValueOnce(new ApiError("Not Found", 404, "Not Found"));

    reporter.onEvent(event("app_error", { where: "a" }));
    await runTimers();

    advance(30 * MINUTE);
    reporter.onEvent(event("app_error", { where: "b" }));
    await runTimers();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not report its own failed send back to itself", async () => {
    const { reporter, send, runTimers, advance } = setup();

    send.mockImplementationOnce(async () => {
      // What the API client's logger does when the request fails.
      reporter.onEvent(event("app_error", { where: "POST /diagnostics/client" }));
      throw new ApiError("Erro", 500, "Internal Server Error");
    });

    reporter.onEvent(event("app_error", { where: "a" }));
    await runTimers();

    advance(30 * MINUTE);
    await runTimers();

    // The first report is retried later; the echo of its own failure is not
    // a second report.
    const bodies = send.mock.calls.map(
      (call) => (call[0] as ReturnType<typeof toClientReport>).errors.map((error) => error.message),
    );

    expect(bodies.flat()).not.toContain("POST /diagnostics/client");
  });
});
