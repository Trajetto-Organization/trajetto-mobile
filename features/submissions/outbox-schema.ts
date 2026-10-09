import { OUTBOX_SCHEMA_VERSION } from "@/utils/client-version";

/**
 * How a queued item lives across app versions.
 *
 * The outbox freezes an item when the driver presses send and delivers it
 * days later, possibly from a newer build of the app and to a newer API. Pure
 * and import-light, like `outbox-rules`, so it can be tested without the
 * device.
 */

/**
 * Reads an item written by any build into the current shape.
 *
 * An item with no `schemaVersion` was written before the field existed (v0).
 * v0 → v1 only adds the field: the endpoint and body are untouched. This is
 * where a future change of shape rewrites an old item — per `kind`, the URL
 * and the body — instead of leaving it to fail against the new API.
 */
function upcastOutboxItem<T extends object>(
  raw: T,
): T & { schemaVersion: number } {
  const written = (raw as { schemaVersion?: unknown }).schemaVersion;
  const version = typeof written === "number" ? written : 0;

  if (version >= OUTBOX_SCHEMA_VERSION) {
    return raw as T & { schemaVersion: number };
  }

  // v0 → v1: the shape is the same; the version is now written down.
  return { ...raw, schemaVersion: OUTBOX_SCHEMA_VERSION };
}

interface FailedItem {
  status: "pending" | "failed" | "parked";
  failure?: string;
  failedOnAppVersion?: string;
}

/**
 * Whether an item that failed on the CONTRACT should go out again now.
 *
 * Only when the app is not the one it failed on: a newer build may speak the
 * contract the API asked for, and the same build certainly does not. Once per
 * update — sending it clears the mark, and failing again records the new
 * version. A refusal on the merits never qualifies: that one is the driver's
 * to read and decide on.
 */
function shouldRequeueAfterUpgrade(
  item: FailedItem,
  currentAppVersion: string | null,
): boolean {
  return (
    item.status === "failed" &&
    item.failure === "contract" &&
    Boolean(item.failedOnAppVersion) &&
    Boolean(currentAppVersion) &&
    item.failedOnAppVersion !== currentAppVersion
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How stale an item is, for the pending screen: a week, then two.
 *
 * Only ever a flag. Deleting an item because it is old would be the very
 * loss the queue exists to prevent — a proof of delivery is still a proof a
 * month later.
 */
function queueAgeWarning(
  createdAt: string,
  now: number,
): { days: number; level: "warning" | "critical" } | null {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return null;

  const days = Math.floor((now - created) / DAY_MS);

  if (days >= 14) return { days, level: "critical" };
  if (days >= 7) return { days, level: "warning" };

  return null;
}

export { queueAgeWarning, shouldRequeueAfterUpgrade, upcastOutboxItem };
