import { User, PermissionKey, Permission } from "../types";

export const checkPermission = (
  user: User | null,
  permissionKey: PermissionKey,
  action: "read" | "write" = "read"
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
      (p: Permission) => p.permissionKey === permissionKey
    );

    if (!permission) return false;
    return action === "read" ? permission.canRead : permission.canWrite;
  }

  return false;
};

export const checkVehiclePermission = (
  user: User | null
): { canRead: boolean; canWrite: boolean } => {
  if (!user) return { canRead: false, canWrite: false };

  if (user.role === "MASTER" || user.role === "BUSINESS_ADMIN") {
    return { canRead: true, canWrite: true };
  }

  if (user.role === "BUSINESS_USER") {
    const canRead = checkPermission(user, "vehicle_manage", "read");
    const canWrite = checkPermission(user, "vehicle_manage", "write");

    return { canRead, canWrite };
  }

  return { canRead: false, canWrite: false };
};

export const checkFuelPermission = (
  user: User | null
): { canRead: boolean; canWrite: boolean } => {
  if (!user) return { canRead: false, canWrite: false };

  if (user.role === "MASTER" || user.role === "BUSINESS_ADMIN") {
    return { canRead: true, canWrite: true };
  }

  if (user.role === "BUSINESS_USER") {
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

export const validateUserAccess = (
  user: User | null
): { hasAccess: boolean; reason?: string } => {
  if (!user) {
    return { hasAccess: false, reason: "user_not_found" };
  }

  if (user.access_revoked) {
    return { hasAccess: false, reason: "access_revoked" };
  }

  // MASTER and BUSINESS_ADMIN always have access
  if (user.role === "MASTER" || user.role === "BUSINESS_ADMIN") {
    return { hasAccess: true };
  }

  // BUSINESS_USER needs vehicle read permission to access the app
  if (user.role === "BUSINESS_USER") {
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
