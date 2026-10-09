import { apiClient } from "@/utils/api";
import { appVersionLabel, getClientVersion } from "@/utils/client-version";
import { isTokenExpired } from "@/utils/jwt";
import { tokenStorage } from "@/utils/storage";
import { setTelemetrySink } from "@/utils/telemetry";

import { useOutboxStore } from "@/store/outbox-store";

import { summarizeOutbox } from "./client-report-rules";
import { createDiagnosticsReporter } from "./diagnostics-reporter";

/**
 * Gives the telemetry pipeline its remote end (OBS-12, closing what MOB-10
 * left open): POST /diagnostics/client on this app's own API. No vendor SDK,
 * no new native module — it reaches the phones in the field over the air.
 *
 * Installed once at boot from app/_layout.tsx, next to the global error
 * handler. Only with a live, unexpired access token: a report must never be
 * what triggers a refresh or a logout. The queue summary comes from the
 * outbox store (what the pending screen shows), never from disk.
 */
let installed = false;

const REPORT_TIMEOUT_MS = 10_000;

function installDiagnosticsReporter(): void {
  if (installed) return;

  installed = true;

  const reporter = createDiagnosticsReporter({
    send: (report) =>
      apiClient.request("/diagnostics/client", {
        method: "POST",
        body: report,
        timeoutMs: REPORT_TIMEOUT_MS,
      }),

    canSend: async () => {
      const token = await tokenStorage.getAccessToken();

      return Boolean(token) && !isTokenExpired(token as string);
    },

    context: () => ({
      platform: getClientVersion()?.platform ?? undefined,
      appVersion: appVersionLabel() ?? undefined,
    }),

    summarizeQueue: async () =>
      summarizeOutbox(useOutboxStore.getState().items, Date.now()),
  });

  setTelemetrySink((event) => reporter.onEvent(event));
}

export { installDiagnosticsReporter };
