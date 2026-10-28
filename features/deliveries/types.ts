import type { DeliveryStatus } from "./delivery-rules";

import type { DriverRouteStop } from "./delivery-rules";
import type { DeliveryKind } from "./delivery-identity-rules";
import type { RoutePlanVersion } from "./plan-change-rules";

interface DriverDeliveryItem {
  id: string;
  description: string;
  quantity: string | number;
  unit?: string | null;
  unit_value?: string | number | null;
}

/** One stop of the day, as `/delivery/my-deliveries` serves it. */
interface DriverDelivery {
  id: string;
  code?: string | null;
  invoice_number?: string | null;

  /**
   * Delivery, pickup or service order. Optional: an API before the field,
   * and the cached lists it wrote (up to seven days), have no key, and read
   * as a delivery (`deliveryKindBadge`). Read through that rule, never
   * compared by hand: a value a newer API adds must not reach the screen raw.
   */
  kind?: DeliveryKind | null;

  status: DeliveryStatus;
  recipient_name: string;
  recipient_telephone?: string | null;
  street: string;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city: string;
  uf: string;
  cep?: string | null;
  scheduled_date?: string | null;

  /** The address's point (decision 14.7); navigation prefers it. */
  latitude?: number | null;
  longitude?: number | null;

  notes?: string | null;
  shipper?: { id: string; name: string } | null;
  items?: DriverDeliveryItem[];

  /**
   * The open stop, when this delivery is on a route — at most one, because the
   * API's partial unique index allows a delivery exactly one.
   *
   * Optional, and not only because a delivery can be off-route: the app renders
   * from up to seven days of cached payloads, and the rows written before this
   * field existed have no key at all.
   */
  stops?: DriverRouteStop[] | null;

  /**
   * The latest tower authorization THIS driver asked for on this delivery
   * (decision 6.3), or null. Optional: cached payloads from before it existed
   * have no key at all.
   */
  authorization_request?: DriverAuthorizationRequest | null;
}

type AuthorizationRequestStatus =
  "PENDING" | "APPROVED" | "DENIED" | "SUPERSEDED";

/** `authorization_request` of `/delivery/my-deliveries` (docs/contratos-app/occurrences.md §4). */
interface DriverAuthorizationRequest {
  occurrenceId: string;
  occurrenceTypeId: string;
  occurrenceTypeName: string;
  status: AuthorizationRequestStatus;

  /** The tower's reason; always present on a denial. */
  note: string | null;
  decidedAt: string | null;
  requestedAt: string;
}

/** The driver's occurrence vocabulary — active types only. */
interface DriverOccurrenceType {
  id: string;
  name: string;
  description: string | null;
  requires_photo: boolean;
  blocks_delivery: boolean;

  /**
   * Decisions 6.2 and 6.3. Optional because the list is cached for seven
   * days: a payload from before forms has none of them, and the app then
   * reads "no form, version 1, no authorization".
   */
  requires_authorization?: boolean;
  form_version?: number;

  /** Raw from the API; read through `readFormFields`, never trusted as is. */
  form_fields?: unknown;

  /**
   * Decision 14.3. Optional for the same reason: a cached payload from
   * before the categories reads as a not-delivered type asking for neither.
   */
  category?: "DELIVERED" | "NOT_DELIVERED" | "PAUSE";
  requires_receipt_photo?: boolean;
  requires_signature?: boolean;

  /** DELIVERED: the company's default ("Entrega normal"), first in the list. */
  is_default?: boolean;
}

/** A pause type of the company (decision 14.4), as the pause picker needs it. */
interface DriverPauseType {
  id: string;
  name: string;
  pause_kind: "MEAL" | "REST" | "OTHER";
  is_default?: boolean;
}

/** Whether a pause may start now, as the server saw it (decision 14.4). */
interface DriverJourney {
  pause_allowed: boolean;
  route_id: string | null;
  /**
   * The company's day the server judged (YYYY-MM-DD) and its zone: the
   * answer is trusted only while that day lasts. Optional on older payloads.
   */
  day?: string;
  time_zone?: string;
}

interface MyDeliveriesResponse {
  data: DriverDelivery[];
  occurrence_types: DriverOccurrenceType[];

  /**
   * Decisions 14.3 and 14.4 (contract 3). Optional: a payload cached before
   * the update has none, and the app then proves with the old route and
   * pauses with the three fixed natures.
   */
  delivered_types?: DriverOccurrenceType[];
  pause_types?: DriverPauseType[];
  journey?: DriverJourney;

  /**
   * The released routes behind the list and their plan versions (route design
   * §4.13). Optional: an API before it and a cached payload have none, and
   * the plan-change notice then stays silent.
   */
  routes?: RoutePlanVersion[];
}

export type {
  AuthorizationRequestStatus,
  DriverAuthorizationRequest,
  DriverDelivery,
  DriverDeliveryItem,
  DriverJourney,
  DriverOccurrenceType,
  DriverPauseType,
  MyDeliveriesResponse,
};
