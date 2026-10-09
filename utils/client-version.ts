/**
 * Which build of the app this is, as the API and the outbox see it.
 *
 * Kept free of imports on purpose: `api.ts` and the outbox read it, and both
 * are tested under plain Node. The values come from the Expo modules, read
 * once at boot by `client-identity.ts`, which is the only file that imports
 * them.
 */

/**
 * The API contract this JavaScript speaks. RAISE IT in every release that
 * changes what the app sends — a route, a body field, an upload shape.
 *
 * It travels as `contract=` in `x-trajetto-client-version`, and the API can
 * refuse anything below MIN_MOBILE_CONTRACT with 426. Because it lives in the
 * JavaScript, an over-the-air update raises it on every phone that takes the
 * update; a phone whose binary cannot take it keeps the old number and is
 * sent to the store. A native build number could not do that: EAS assigns it
 * remotely, and the JavaScript cannot read it reliably.
 */
// 2: occurrence reports carry `form_version` (and the form's answers) —
// docs/contratos-app/occurrences.md §7.
// 3: delivery proof is a DELIVERED occurrence; pauses carry occurrence_type_id
// (decisions 14.3 and 14.4).
const CLIENT_CONTRACT = 3;

/**
 * The shape of the items this app writes into the outbox. Raise it when an
 * item's fields change, together with a step in `upcastOutboxItem`.
 */
const OUTBOX_SCHEMA_VERSION = 1;

interface ClientVersion {
  platform: string;
  version?: string | null;
  build?: string | number | null;
  runtime?: string | null;
  update?: string | null;
}

let current: ClientVersion | null = null;

/** Called once at boot, by `client-identity.ts`. */
function setClientVersion(version: ClientVersion | null): void {
  current = version;
}

function getClientVersion(): ClientVersion | null {
  return current;
}

// `;` and `=` separate the fields; a value is never allowed to carry them.
const clean = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;

  const text = String(value).replace(/[;=\s]/g, "").slice(0, 64);
  return text.length > 0 ? text : null;
};

/**
 * `x-trajetto-client-version`, e.g.
 * `platform=android; version=1.0.0; build=42; runtime=ab12; update=embedded;
 * contract=1; outbox=1`.
 */
function formatClientVersion(version: ClientVersion): string {
  const fields: Array<[string, unknown]> = [
    ["platform", version.platform],
    ["version", version.version],
    ["build", version.build],
    ["runtime", version.runtime],
    ["update", version.update ?? "embedded"],
    ["contract", CLIENT_CONTRACT],
    ["outbox", OUTBOX_SCHEMA_VERSION],
  ];

  return fields
    .map(([key, value]) => [key, clean(value)] as const)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

/** The header value, or null before the boot code described the app. */
function clientVersionHeader(): string | null {
  return current ? formatClientVersion(current) : null;
}

/**
 * What changes whenever the JavaScript or the binary does: an over-the-air
 * update changes `update`, a store update changes `runtime` or `build`. The
 * outbox compares it to decide that the app was updated since an item failed
 * on a contract.
 */
function appVersionLabel(version: ClientVersion | null = current): string | null {
  if (!version) return null;

  return [
    version.version,
    version.build,
    version.runtime,
    version.update ?? "embedded",
    CLIENT_CONTRACT,
  ]
    .map((part) => clean(part) ?? "-")
    .join("/");
}

export {
  CLIENT_CONTRACT,
  OUTBOX_SCHEMA_VERSION,
  appVersionLabel,
  clientVersionHeader,
  formatClientVersion,
  getClientVersion,
  setClientVersion,
};
export type { ClientVersion };
