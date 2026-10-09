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
  const admin = asUser({
    role: "BUSINESS_ADMIN",
    enabledModules: ["FLEET", "DELIVERIES"],
  });

  it("can do everything without a profile", () => {
    expect(checkPermission(admin, "fuel_manage", "write")).toBe(true);
    expect(checkVehiclePermission(admin)).toEqual({
      canRead: true,
      canWrite: true,
    });
    expect(checkFuelPermission(admin).canWrite).toBe(true);
    expect(checkChecklistPermission(admin).canWrite).toBe(true);
  });

  it("is not offered what the company did not hire", () => {
    // The role bypasses permissions, never the plan (decision 4.3).
    const deliveriesOnlyAdmin = asUser({
      role: "BUSINESS_ADMIN",
      enabledModules: ["DELIVERIES"],
    });

    expect(checkFuelPermission(deliveriesOnlyAdmin).canWrite).toBe(false);
    expect(checkChecklistPermission(deliveriesOnlyAdmin).canWrite).toBe(false);
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

describe("a MASTER looking at a company", () => {
  it("gets the fleet forms only when that company hired Gestão de Frota", () => {
    // `enabledModules` is the SELECTED company's plan for a MASTER, not the
    // everything `/user/me` answers for the back office (decision 4.3).
    const onFleetCompany = asUser({
      role: "MASTER",
      businessId: "b1",
      enabledModules: ["FLEET"],
    });
    const onDeliveriesCompany = asUser({
      role: "MASTER",
      businessId: "b2",
      enabledModules: ["DELIVERIES"],
    });

    expect(checkFuelPermission(onFleetCompany).canWrite).toBe(true);
    expect(checkFuelPermission(onDeliveriesCompany).canWrite).toBe(false);
    expect(checkChecklistPermission(onDeliveriesCompany).canWrite).toBe(false);
  });

  it("gets none while the company's plan is still unknown", () => {
    // Just switched company: the plan is being fetched. Offering the forms in
    // that window would be offering the previous company's plan.
    expect(
      checkFuelPermission(asUser({ role: "MASTER", businessId: "b2" })).canWrite,
    ).toBe(false);
  });
});

describe("a driver", () => {
  const driver = asUser({ driverId: "d1", enabledModules: ["FLEET"] });

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

  it("records refuelling and checklists when the company hired Gestão de Frota", () => {
    // Both are things done at the pump and in the yard.
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

  it("is offered neither when the company did not hire Gestão de Frota", () => {
    /**
     * MOB-02, and the case this test used to pin the other way round.
     *
     * Being a driver said "may refuel" regardless of the plan, so a driver of
     * a company that only hired Entregas saw "Abastecer" and "Checklist" on
     * every vehicle, filled the whole form, photographed the odometer — and
     * the API refused it with MODULE_NOT_ENABLED, or the offline queue parked
     * it. The role says who may use the module; the plan says whether it
     * exists.
     */
    const deliveriesOnly = asUser({
      driverId: "d1",
      enabledModules: ["DELIVERIES"],
    });

    expect(checkFuelPermission(deliveriesOnly)).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(checkChecklistPermission(deliveriesOnly)).toEqual({
      canRead: false,
      canWrite: false,
    });
    expect(canRefuelVehicles(deliveriesOnly)).toBe(false);

    // A plan that lists no module is not a plan with the fleet.
    expect(
      checkFuelPermission(asUser({ driverId: "d1", enabledModules: [] })).canWrite,
    ).toBe(false);
  });

  it("keeps the fleet while the plan is unknown, as the builds without plans did", () => {
    // Only a user persisted by those builds has no plan at all (/user/me
    // always sends one). Cold-starting offline right after the update keeps
    // that cached user, and reading "unknown" as "none" took refuelling and
    // checklists away until the network came back.
    const cached = asUser({ driverId: "d1" });

    expect(checkFuelPermission(cached).canWrite).toBe(true);
    expect(checkChecklistPermission(cached).canWrite).toBe(true);

    // A MASTER's unknown plan is waited for instead (checking-modules).
    expect(
      checkFuelPermission(asUser({ role: "MASTER", businessId: "b2" })).canWrite,
    ).toBe(false);
  });

  it("still reads the vehicles it drives without the module", () => {
    // Vehicles are common ground: Entregas assigns them to routes too, and
    // the API does not gate them by module.
    expect(
      checkVehiclePermission(
        asUser({ driverId: "d1", enabledModules: ["DELIVERIES"] }),
      ).canRead,
    ).toBe(true);
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

  it("is refused entry with a profile that grants nothing", () => {
    // Keys present but every flag off: the same as no profile, and the same
    // answer the API gives such a session.
    expect(validateUserAccess(withProfile("vehicle_manage", false, false))).toEqual({
      hasAccess: false,
      reason: "no_permissions",
    });
  });

  it("gets in with a delivery-only profile: a control-tower operator", () => {
    /**
     * CRIT-20. Entry used to demand `vehicle_manage`, so an operator whose
     * profile covers only Entregas was turned away at login with "sem
     * permissão para visualizar veículos" — while the web let them in and
     * the API accepts the session. The app lets them in; what each screen
     * shows is decided per screen, and "Início" says when nothing here is
     * theirs.
     */
    expect(
      validateUserAccess(
        asUser({
          enabledModules: ["DELIVERIES"],
          profileAccess: {
            permissions: [
              { permissionKey: "delivery_manage", canRead: true, canWrite: false },
            ],
          },
        } as unknown as Partial<User>),
      ),
    ).toEqual({ hasAccess: true });
  });

  it("gets in holding permissions that open no screen here", () => {
    // Same rule for any profile that grants something: notifications reach
    // them in the app, and the home screen explains the rest.
    expect(validateUserAccess(withProfile("fuel_manage", true, true))).toEqual({
      hasAccess: true,
    });
  });

  it("gets in when the profile opens a vehicle screen", () => {
    expect(validateUserAccess(withProfile("vehicle_manage", true, false))).toEqual({
      hasAccess: true,
    });
  });

  it("gets the fleet forms from the profile, and only with the module", () => {
    const refueller = asUser({
      enabledModules: ["FLEET"],
      profileAccess: {
        permissions: [
          { permissionKey: "fuel_manage", canRead: true, canWrite: true },
          {
            permissionKey: "vehicle_checklist_manage",
            canRead: true,
            canWrite: false,
          },
        ],
      },
    } as unknown as Partial<User>);

    expect(checkFuelPermission(refueller)).toEqual({
      canRead: true,
      canWrite: true,
    });

    // Read-only is not write, whatever the module says.
    expect(checkChecklistPermission(refueller)).toEqual({
      canRead: true,
      canWrite: false,
    });

    expect(
      checkFuelPermission({ ...refueller, enabledModules: ["DELIVERIES"] }),
    ).toEqual({ canRead: false, canWrite: false });
  });
});
