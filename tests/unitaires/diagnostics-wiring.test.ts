import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * OBS-12 / MOB-10: the telemetry pipeline had no remote end — every scrubbed,
 * throttled failure stayed in a 50-event buffer on the phone. Installed at
 * boot, the diagnostics reporter is that end: POST /diagnostics/client on the
 * app's own API, with the session it already has.
 */
const request = vi.fn(async () => ({ received: true }));

vi.mock("@/utils/api", () => ({ apiClient: { request } }));

vi.mock("@/utils/storage", () => ({
  tokenStorage: { getAccessToken: async () => "token-de-acesso" },
}));

vi.mock("@/utils/jwt", () => ({ isTokenExpired: () => false }));

vi.mock("@/store/outbox-store", () => ({
  useOutboxStore: {
    getState: () => ({
      items: [
        {
          status: "pending",
          attempts: 4,
          createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        },
      ],
    }),
  },
}));

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

describe("the diagnostics reporter, installed", () => {
  it("sends what the telemetry saw to the API", async () => {
    const { installDiagnosticsReporter } = await import(
      "@/features/diagnostics/install-diagnostics"
    );
    const { reportEvent } = await import("@/utils/telemetry");

    installDiagnosticsReporter();

    reportEvent("outbox_item_failed", {
      kind: "delivery-proof",
      failure: "transient",
      source: "upload",
      status: 403,
      host: "acc.r2.cloudflarestorage.com",
    });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(request).toHaveBeenCalledTimes(1);

    const [endpoint, config] = request.mock.calls[0] as unknown as [
      string,
      { method: string; body: Record<string, unknown> },
    ];

    expect(endpoint).toBe("/diagnostics/client");
    expect(config.method).toBe("POST");
    expect(config.body).toMatchObject({
      outbox: { pending: 1, failed: 0, stuck: 1 },
      errors: [
        expect.objectContaining({
          kind: "upload",
          status: 403,
          host: "acc.r2.cloudflarestorage.com",
        }),
      ],
    });
  });

  it("is installed at boot, next to the global error handler", () => {
    const layout = readFileSync(resolve(__dirname, "../../app/_layout.tsx"), "utf8");

    expect(layout).toMatch(/installDiagnosticsReporter\(\);/);
  });
});
