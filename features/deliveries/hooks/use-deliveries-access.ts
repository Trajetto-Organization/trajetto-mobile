import { useAuthStore } from "@/store/auth-store";

import { hasDeliveriesAccess } from "../delivery-rules";

/**
 * Whether the Deliveries entry exists for this session: a driver-linked
 * user in a business with the DELIVERIES module enabled. Reads the same
 * /user/me the session already keeps fresh — no extra request, and the
 * entry follows an entitlement change on the next refresh.
 */
function useDeliveriesAccess(): boolean {
  const user = useAuthStore((state) => state.user);

  return hasDeliveriesAccess(user);
}

export { useDeliveriesAccess };
