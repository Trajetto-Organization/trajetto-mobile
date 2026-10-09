import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REPORT_WINDOW_MS,
  createReportThrottle,
  scrubText,
} from "@/utils/telemetry-rules";

/**
 * What the app says about its own failures, and what it must never say (MOB-10).
 *
 * The logger wrote to the phone's console and nowhere else: a dropped queue
 * file, a refresh refused as reuse, a socket refused on every handshake — the
 * operation learned about each from a driver complaining. Everything the app
 * reports now goes through one pipeline, and that pipeline is where personal
 * data is stripped and where a failure repeating in a loop becomes one report.
 */

describe("what a report may contain", () => {
  it.each([
    ["an access token", "falhou com Bearer eyJhbGciOi.abc.def", "Bearer eyJ"],
    ["a bare JWT", "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "eyJhbGci"],
    ["an e-mail", "usuário joao.silva@empresa.com.br não encontrado", "joao.silva@"],
    ["a CPF", "motorista 123.456.789-00 inativo", "123.456.789-00"],
    ["a bare CPF", "motorista 12345678900 inativo", "12345678900"],
    ["a push token", "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx] rejeitado", "xxxxxxxx"],
    [
      "a presigned URL's signature",
      "PUT https://r2.example.com/b/k.jpg?X-Amz-Signature=abc123 falhou",
      "X-Amz-Signature",
    ],
  ])("strips %s", (_label, text, secret) => {
    const scrubbed = scrubText(text);

    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain("[redacted]");
  });

  it("keeps what is useful", () => {
    expect(scrubText("outbox: queue file was unreadable")).toBe(
      "outbox: queue file was unreadable",
    );
  });

  it("is short", () => {
    expect(scrubText("x".repeat(5_000)).length).toBeLessThanOrEqual(300);
  });
});

describe("how often the same failure is reported", () => {
  it("once per window, per kind of failure", () => {
    const shouldReport = createReportThrottle();

    expect(shouldReport("outbox_item_failed|HTTP_409", 0)).toBe(true);
    expect(shouldReport("outbox_item_failed|HTTP_409", 60_000)).toBe(false);
    expect(shouldReport("outbox_item_failed|MODULE_NOT_ENABLED", 60_000)).toBe(true);
    expect(shouldReport("outbox_item_failed|HTTP_409", REPORT_WINDOW_MS)).toBe(true);
  });
});

describe("the pipeline", () => {
  let telemetry: typeof import("@/utils/telemetry");
  const sink = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    sink.mockReset();

    telemetry = await import("@/utils/telemetry");
    telemetry.setTelemetrySink(sink);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands the sink a scrubbed event", () => {
    telemetry.reportEvent("refresh_rejected", {
      code: "AUTH_REFRESH_REUSED",
      where: "sessão de joao@x.com",
    });

    expect(sink).toHaveBeenCalledTimes(1);

    const [event] = sink.mock.calls[0];
    expect(event).toMatchObject({
      name: "refresh_rejected",
      tags: { code: "AUTH_REFRESH_REUSED" },
    });
    expect(JSON.stringify(event)).not.toContain("joao@x.com");
  });

  it("turns a failure looping in the background into one report", () => {
    for (let i = 0; i < 50; i += 1) {
      telemetry.reportEvent("socket_refused", { code: "AUTH_TOKEN_INVALID" });
    }

    telemetry.reportEvent("socket_refused", { code: "RATE_LIMITED" });

    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("never breaks the app when the sink does", () => {
    telemetry.setTelemetrySink(() => {
      throw new Error("sink down");
    });

    expect(() => telemetry.reportEvent("app_error", { where: "x" })).not.toThrow();
  });

  it("keeps the latest events for a diagnostics report, bounded", () => {
    telemetry.setTelemetrySink(null);

    for (let i = 0; i < 120; i += 1) {
      telemetry.reportEvent("app_error", { where: `falha ${i}` });
    }

    const recent = telemetry.getRecentTelemetry();

    expect(recent.length).toBeLessThanOrEqual(50);
    expect(recent.at(-1)?.tags.where).toBe("falha 119");
  });

  it("forwards logger.error, which is where the app already says what went wrong", async () => {
    const { logger } = await import("@/utils/logger");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    logger.error("logout: one or more storage cleanups failed", new Error("x"));

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "app_error",
        tags: expect.objectContaining({
          where: "logout: one or more storage cleanups failed",
        }),
      }),
    );
  });

  it("records an uncaught JavaScript error, then lets React Native handle it", () => {
    const previous = vi.fn();
    let installed: ((error: Error, isFatal?: boolean) => void) | null = null;

    vi.stubGlobal("ErrorUtils", {
      getGlobalHandler: () => previous,
      setGlobalHandler: (handler: typeof installed) => {
        installed = handler;
      },
    });

    telemetry.installGlobalErrorHandler();

    const crash = new TypeError("Cannot read properties of undefined");
    installed!(crash, true);

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "js_error",
        tags: expect.objectContaining({ code: "TypeError", fatal: true }),
      }),
    );
    expect(previous).toHaveBeenCalledWith(crash, true);
  });
});
