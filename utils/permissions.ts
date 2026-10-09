import { User, PermissionKey, Permission } from "../types";

import { FLEET_MODULE, hasModule } from "../features/access/module-rules";

const NO_ACCESS = { canRead: false, canWrite: false } as const;

export const checkPermission = (
  user: User | null,
  permissionKey: PermissionKey,
  action: "read" | "write" = "read",
): boolean => {
  if (!user) return false;

  // MASTER has access to everything
  if (user.role === "MASTER") return true;

  // BUSINESS_ADMIN has access to everything within their business
  if (user.role === "BUSINESS_ADMIN") return true;

  // BUSINESS_USER needs specific permissions
  if (user.role === "BUSINESS_USER") {
    if (!user.profileAccess?.permissions) return false;

    const permission = user.profileAccess.permissions.find(
      (p: Permission) => p.permissionKey === permissionKey,
    );

    if (!permission) return false;
    return action === "read" ? permission.canRead : permission.canWrite;
  }

  return false;
};

export const checkVehiclePermission = (
  user: User | null,
): { canRead: boolean; canWrite: boolean } => {
  if (!user) return { canRead: false, canWrite: false };

  if (user.role === "MASTER" || user.role === "BUSINESS_ADMIN") {
    return { canRead: true, canWrite: true };
  }

  if (user.role === "BUSINESS_USER") {
    // Drivers have read-only access to their vehicles
    if (user.driverId) {
      return { canRead: true, canWrite: false };
    }

    const canRead = checkPermission(user, "vehicle_manage", "read");
    const canWrite = checkPermission(user, "vehicle_manage", "write");

    return { canRead, canWrite };
  }

  return { canRead: false, canWrite: false };
};

/**
 * Refuelling is a Gestão de Frota feature, for everyone — drivers, admins and
 * a MASTER looking at a company alike. The role only decides WHO may use the
 * module; whether the company hired it decides whether it exists at all
 * (MOB-02: the phone offered it with the module off, and the API refused the
 * finished form).
 */
export const checkFuelPermission = (
  user: User | null,
): { canRead: boolean; canWrite: boolean } => {
  if (!user || !hasModule(user, FLEET_MODULE)) return { ...NO_ACCESS };

  if (user.role === "MASTER" || user.role === "BUSINESS_ADMIN") {
    return { canRead: true, canWrite: true };
  }

  if (user.role === "BUSINESS_USER") {
    // Drivers can create fuel records for their vehicles
    if (user.driverId) {
      return { canRead: true, canWrite: true };
    }

    const canRead = checkPermission(user, "fuel_manage", "read");
    const canWrite = checkPermission(user, "fuel_manage", "write");

    return { canRead, canWrite };
  }

  return { canRead: false, canWrite: false };
};

export const hasAnyVehiclePermission = (user: User | null): boolean => {
  const permissions = checkVehiclePermission(user);
  return permissions.canRead || permissions.canWrite;
};

export const canRefuelVehicles = (user: User | null): boolean => {
  const permissions = checkFuelPermission(user);
  return permissions.canWrite;
};

/** Same rule as refuelling: a Gestão de Frota feature before a permission. */
export const checkChecklistPermission = (
  user: User | null,
): { canRead: boolean; canWrite: boolean } => {
  if (!user || !hasModule(user, FLEET_MODULE)) return { ...NO_ACCESS };

  if (user.role === "MASTER" || user.role === "BUSINESS_ADMIN") {
    return { canRead: true, canWrite: true };
  }

  if (user.role === "BUSINESS_USER") {
    // Drivers can create checklists for their vehicles
    if (user.driverId) {
      return { canRead: true, canWrite: true };
    }

    // For now, use vehicle_manage permission for checklist
    // This can be changed later to a specific checklist permission
    const canRead = checkPermission(user, "vehicle_checklist_manage", "read");
    const canWrite = checkPermission(user, "vehicle_checklist_manage", "write");

    return { canRead, canWrite };
  }

  return { canRead: false, canWrite: false };
};

export const validateUserAccess = (
  user: User | null,
): { hasAccess: boolean; reason?: string } => {
  if (!user) {
    return { hasAccess: false, reason: "user_not_found" };
  }

  if (user.access_revoked) {
    return { hasAccess: false, reason: "access_revoked" };
  }

  // Check if driver is inactive
  if (user.driver && user.driver.status === "INACTIVE") {
    return { hasAccess: false, reason: "driver_inactive" };
  }

  // MASTER and BUSINESS_ADMIN always have access
  if (user.role === "MASTER" || user.role === "BUSINESS_ADMIN") {
    return { hasAccess: true };
  }

  // BUSINESS_USER validation
  if (user.role === "BUSINESS_USER") {
    // If user is a driver (has driverId), they have access
    // Drivers don't need profileAccess or permissions
    if (user.driverId) {
      return { hasAccess: true };
    }

    // Mirrors the API's session eligibility: an office user needs a profile
    // that grants something. WHAT it grants is not the gate any more — a
    // control-tower operator with only `delivery_manage` was refused at login
    // for lacking `vehicle_manage` (CRIT-20). Each screen now decides what it
    // shows, and the home screen says when nothing here is theirs.
    const grantsSomething = (user.profileAccess?.permissions ?? []).some(
      (permission) => permission.canRead || permission.canWrite,
    );

    if (!grantsSomething) {
      return { hasAccess: false, reason: "no_permissions" };
    }

    return { hasAccess: true };
  }

  return { hasAccess: false, reason: "invalid_role" };
};

// Helper for branch permissions
export const checkBranchPermission = (
  user: User | null,
): { canRead: boolean; canWrite: boolean } => {
  if (!user) return { canRead: false, canWrite: false };

  if (user.role === "MASTER" || user.role === "BUSINESS_ADMIN") {
    return { canRead: true, canWrite: true };
  }

  if (user.role === "BUSINESS_USER") {
    // Drivers can read branches (to select branch for fuel/checklist)
    if (user.driverId) {
      return { canRead: true, canWrite: false };
    }

    const canRead = checkPermission(user, "branch_manage", "read");
    const canWrite = checkPermission(user, "branch_manage", "write");

    return { canRead, canWrite };
  }

  return { canRead: false, canWrite: false };
};

// Helper for fuel type permissions
export const checkFuelTypePermission = (
  user: User | null,
): { canRead: boolean; canWrite: boolean } => {
  if (!user) return { canRead: false, canWrite: false };

  if (user.role === "MASTER" || user.role === "BUSINESS_ADMIN") {
    return { canRead: true, canWrite: true };
  }

  if (user.role === "BUSINESS_USER") {
    // Drivers can read fuel types (to select fuel type when creating fuel)
    if (user.driverId) {
      return { canRead: true, canWrite: false };
    }

    const canRead = checkPermission(user, "fuel_type_manage", "read");
    const canWrite = checkPermission(user, "fuel_type_manage", "write");

    return { canRead, canWrite };
  }

  return { canRead: false, canWrite: false };
};
