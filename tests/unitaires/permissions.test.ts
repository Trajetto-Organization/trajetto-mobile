import { describe, expect, it } from "vitest";

import {
  canRefuelVehicles,
  checkChecklistPermission,
  checkFuelPermission,
  checkPermission,
  checkVehiclePermission,
  hasAnyVehiclePermission,
  validateUserAccess,
} from "@/utils/permissions";

import type { User } from "@/types";

/**
 * What the app lets a driver do, decided on the phone.
 *
 * The API is the real gate — every one of these calls is checked again on the
 * server, and this file does not pretend otherwise. What it decides is what
 * the driver SEES: which tabs exist, which buttons are enabled, whether the
 * app lets them in at all. Getting it wrong in the permissive direction shows
 * somebody a screen that then refuses everything they touch; in the strict
 * direction it hides the job they were sent out to do.
 *
 * The ordering inside `validateUserAccess` is the part that matters most, and
 * it is invisible in a review: `access_revoked` is read BEFORE the shortcut
 * that lets a MASTER through. Swap the two and revoking an administrator stops
 * working on the phone, which is the one device they would still be holding.
 */
const asUser = (extra: Partial<User>): User =>
  ({
    id: "u1",
    name: "Alguém",
    email: "alguem@exemplo.com.br",
    role: "BUSINESS_USER",
    businessId: "b1",
    ...extra,
  }) as User;

const withProfile = (
  permissionKey: string,
  canRead: boolean,
  canWrite: boolean,
): User =>
  asUser({
    profileAccess: {
      permissions: [{ permissionKey, canRead, canWrite }],
    },
  } as unknown as Partial<User>);

describe("nobody at all", () => {
  it("can do nothing", () => {
    // Fail closed. A null user reaches these functions while the session is
    // still loading, and answering "true" for that instant is how a screen
    // flashes content the person is not allowed to see.
    expect(checkPermission(null, "fuel_manage")).toBe(false);
    expect(checkVehiclePermission(null)).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(checkFuelPermission(null)).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(checkChecklistPermission(null)).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(hasAnyVehiclePermission(null)).toBe(false);
    expect(canRefuelVehicles(null)).toBe(false);
  });

  it("is not let into the app", () => {
    expect(validateUserAccess(null)).toEqual({
      hasAccess: false,
      reason: "user_not_found",
    });
  });
});

describe("an administrator", () => {
  const admin = asUser({ role: "BUSINESS_ADMIN" });

  it("can do everything without a profile", () => {
    expect(checkPermission(admin, "fuel_manage", "write")).toBe(true);
    expect(checkVehiclePermission(admin)).toEqual({
      canRead: true,
      canWrite: true,
    });
  });

  it("is still refused once their access is revoked", () => {
    /**
     * The ordering, stated as a test.
     *
     * `access_revoked` is read before the MASTER/ADMIN shortcut. Move the
     * shortcut up — an easy, innocent-looking refactor — and revoking an
     * administrator stops working on the phone entirely, silently, for
     * exactly the person whose access somebody urgently wanted to remove.
     */
    expect(
      validateUserAccess(asUser({ role: "BUSINESS_ADMIN", access_revoked: true })),
    ).toEqual({ hasAccess: false, reason: "access_revoked" });

    expect(
      validateUserAccess(asUser({ role: "MASTER", access_revoked: true })),
    ).toEqual({ hasAccess: false, reason: "access_revoked" });
  });
});

describe("a driver", () => {
  const driver = asUser({ driverId: "d1" });

  it("gets in without any profile at all", () => {
    // Drivers are not given an access profile: the app is their whole job, and
    // requiring one would mean nobody could hand a phone to a new hire.
    expect(validateUserAccess(driver)).toEqual({ hasAccess: true });
  });

  it("reads vehicles but does not edit them", () => {
    expect(checkVehiclePermission(driver)).toEqual({
      canRead: true,
      canWrite: false,
    });
  });

  it("records refuelling and checklists", () => {
    // Both are things done at the pump and in the yard, which is the whole
    // reason the app exists.
    expect(checkFuelPermission(driver)).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(checkChecklistPermission(driver)).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(canRefuelVehicles(driver)).toBe(true);
  });

  it("is locked out once the driver record goes inactive", () => {
    expect(
      validateUserAccess(
        asUser({
          driverId: "d1",
          driver: { status: "INACTIVE" },
        } as unknown as Partial<User>),
      ),
    ).toEqual({ hasAccess: false, reason: "driver_inactive" });
  });

  it("is locked out once access is revoked", () => {
    expect(
      validateUserAccess(asUser({ driverId: "d1", access_revoked: true })),
    ).toEqual({ hasAccess: false, reason: "access_revoked" });
  });
});

describe("an office user with a profile", () => {
  it("gets exactly what the profile grants, per action", () => {
    const readOnly = withProfile("fuel_manage", true, false);

    expect(checkPermission(readOnly, "fuel_manage", "read")).toBe(true);

    // The half that a single boolean would have collapsed: being allowed to
    // look at the refuelling history is not being allowed to add one.
    expect(checkPermission(readOnly, "fuel_manage", "write")).toBe(false);
  });

  it("gets nothing for a key the profile does not mention", () => {
    expect(
      checkPermission(withProfile("fuel_manage", true, true), "vehicle_manage"),
    ).toBe(false);
  });

  it("defaults to asking about reading", () => {
    // The default argument matters: a caller that omits it is asking "can
    // they see this", and answering with the write flag would hide screens.
    const readOnly = withProfile("vehicle_manage", true, false);

    expect(checkPermission(readOnly, "vehicle_manage")).toBe(true);
  });

  it("is refused entry with no permissions at all", () => {
    expect(
      validateUserAccess(
        asUser({
          profileAccess: { permissions: [] },
        } as unknown as Partial<User>),
      ),
    ).toEqual({
      hasAccess: false,
      reason: "no_permissions",
    });

    expect(validateUserAccess(asUser({}))).toEqual({
      hasAccess: false,
      reason: "no_permissions",
    });
  });

  it("is refused entry holding permissions that open no screen here", () => {
    // The driver app is built around vehicles. Somebody whose profile only
    // covers, say, accounts payable would land on an empty app — better to
    // say so than to show them nothing and let them think it is broken.
    expect(validateUserAccess(withProfile("fuel_manage", true, true))).toEqual({
      hasAccess: false,
      reason: "no_vehicle_permission",
    });
  });

  it("gets in when the profile opens a vehicle screen", () => {
    expect(validateUserAccess(withProfile("vehicle_manage", true, false))).toEqual({
      hasAccess: true,
    });
  });
});
