/**
 * The API's word that a company catalog changed (`catalogChanged`, decision
 * 2.3), and which of the app's lists it makes stale.
 *
 * Sent to every login of the company after a shipper, occurrence type,
 * vehicle, driver… is created, edited, (de)activated or deleted. It carries
 * no data — only `{ businessId, entity }` — so the app refetches through the
 * API, which re-checks what this session may read. A lost event only means
 * the list waits for its next refetch or a pull-to-refresh.
 *
 * Without it the app kept offering what the panel had just taken away: an
 * occurrence type deactivated at 9h was still in the driver's picker at 17h,
 * and the report failed on send.
 *
 * Pure and import-free, so the mapping is tested where it is decided.
 */

const CATALOG_CHANGED_EVENT = "catalogChanged";

/** The entities trajetto-api `sendCatalogChangedEvent` announces. */
type CatalogEntity =
  | "shipper"
  | "occurrence_type"
  | "status_reason"
  | "message_template"
  | "vehicle"
  | "driver"
  | "branch"
  | "supplier"
  | "part"
  | "vehicle_type"
  | "fuel_type"
  | "profile_access";

/**
 * The query roots each catalog is read under in this app. Every key below is
 * `[root, businessId, ...]`, so `[root, businessId]` reaches all of them and
 * nothing of another company.
 *
 * Absent on purpose: what the app never shows (status reasons, message
 * templates, suppliers, parts, vehicle types) and `profile_access`, whose
 * effect on this session already arrives as `securityAction`
 * `permissions_changed`. `shipper` too: the driver never picks one, and the
 * name on a card is not worth refetching every driver's day for each edit.
 */
const QUERY_ROOTS_BY_ENTITY: Readonly<Partial<Record<CatalogEntity, readonly string[]>>> = {
  // The occurrence types the driver picks from travel in the day's payload.
  occurrence_type: ["my-deliveries"],
  vehicle: ["vehicles", "vehicle"],
  driver: ["drivers"],
  branch: ["branches"],
  fuel_type: ["fuelTypes"],
};

interface CatalogChangedPayload {
  businessId: string;
  entity: string;
}

function isCatalogChangedPayload(value: unknown): value is CatalogChangedPayload {
  if (!value || typeof value !== "object") return false;

  const { businessId, entity } = value as Record<string, unknown>;

  return (
    typeof businessId === "string" &&
    businessId.length > 0 &&
    typeof entity === "string"
  );
}

/**
 * The query-key prefixes to invalidate for one event; empty for a malformed
 * payload, an entity this app does not read, or another company's event
 * (the socket only joins its own company's room, so that is a stale socket
 * outliving a company switch, and its refetches would be wasted).
 */
function catalogQueryKeys(
  event: unknown,
  sessionBusinessId: string | null | undefined,
): string[][] {
  if (!isCatalogChangedPayload(event)) return [];
  if (!sessionBusinessId || event.businessId !== sessionBusinessId) return [];

  // Own keys only: the entity comes from the network.
  const roots = Object.prototype.hasOwnProperty.call(
    QUERY_ROOTS_BY_ENTITY,
    event.entity,
  )
    ? QUERY_ROOTS_BY_ENTITY[event.entity as CatalogEntity]
    : undefined;

  return (roots ?? []).map((root) => [root, event.businessId]);
}

export { CATALOG_CHANGED_EVENT, QUERY_ROOTS_BY_ENTITY, catalogQueryKeys };
export type { CatalogChangedPayload, CatalogEntity };
