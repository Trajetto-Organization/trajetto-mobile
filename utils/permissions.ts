import { User, PermissionKey, Permission } from "../types";

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

export const checkFuelPermission = (
  user: User | null,
): { canRead: boolean; canWrite: boolean } => {
  if (!user) return { canRead: false, canWrite: false };

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

export const checkChecklistPermission = (
  user: User | null,
): { canRead: boolean; canWrite: boolean } => {
  if (!user) return { canRead: false, canWrite: false };

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

    // If not a driver, check for profileAccess and permissions
    if (
      !user.profileAccess?.permissions ||
      user.profileAccess.permissions.length === 0
    ) {
      return { hasAccess: false, reason: "no_permissions" };
    }

    const hasVehicleAccess = hasAnyVehiclePermission(user);

    if (!hasVehicleAccess) {
      return { hasAccess: false, reason: "no_vehicle_permission" };
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
